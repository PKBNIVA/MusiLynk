# Portfolios: many per person or Page, each a view over the owner's one library of work samples
# (see Portfolio). Every action works on the portfolios of the identity the request acts as (the
# X-MusiLynk-Act-As header, see ActingAs), so a Page's portfolios are managed while acting as it.
# GET /api/public/portfolios/:slug is the public (EPK) view of a public or link-only portfolio.
class PortfoliosController < ApplicationController
  include ActingAs
  include UserRateLimit
  include ScalarParams

  CREATES_PER_HOUR = 30
  DRAFTS_PER_HOUR = 60
  PLAIN_FIELDS = %w[title purpose visibility].freeze
  # Sent as null (or "") to go back to inheriting the master copy.
  OVERRIDE_TEXT = %w[headline bio city].freeze
  ID_LISTS = { pinnedItemIds: :pinned_item_ids, excludedItemIds: :excluded_item_ids, itemOrder: :item_order }.freeze
  ITEM_STATES = %w[pinned excluded auto].freeze

  before_action -> { authenticate!("jobseeker", "employer") }, except: :public_show

  def index
    return unless (actor = current_actor)
    portfolios = Portfolio.owned_by(actor).with_owner.order(is_default: :desc, updated_at: :desc, id: :asc).to_a
    library = portfolios.any? ? portfolios.first.library : []
    render json: {
      portfolios: portfolios.map do |portfolio|
        members = portfolio.members(library)
        portfolio.api_json.merge(itemCount: members.length, itemIds: members.map { _1.first.id })
      end,
      limit: Portfolio::MAX_PER_OWNER
    }
  end

  def show
    return unless (portfolio = owned_portfolio)
    render json: { portfolio: full_json(portfolio) }
  end

  def create
    return unless (actor = current_actor)
    return unless require_scalar_params!(*PLAIN_FIELDS, *OVERRIDE_TEXT, :isDefault)
    return unless within_user_rate_limit?("portfolio-create", limit: CREATES_PER_HOUR, period: 1.hour)

    portfolio = Portfolio.new(owner_type: actor.type, owner_id: actor.id)
    return unless assign_fields(portfolio)
    Portfolio.transaction do
      # Serialises creates for one owner so the cap cannot be raced past.
      actor.record.lock!
      existing = Portfolio.owned_by(actor).count
      if existing >= Portfolio::MAX_PER_OWNER
        render_error("You can have up to #{Portfolio::MAX_PER_OWNER} portfolios. Delete one to add another.", :unprocessable_content, "LIMIT_REACHED")
        raise ActiveRecord::Rollback
      end
      portfolio.save!
      portfolio.make_default! if existing.zero? || truthy?(params[:isDefault])
    end
    return if performed?

    audit!("portfolios.create", portfolio, actingAs: actor.key)
    render json: { id: portfolio.id, portfolio: full_json(portfolio) }, status: :created
  end

  def update
    return unless require_scalar_params!(*PLAIN_FIELDS, *OVERRIDE_TEXT, :isDefault)
    return unless (portfolio = owned_portfolio)
    return unless assign_fields(portfolio)
    Portfolio.transaction do
      portfolio.save!
      portfolio.make_default! if truthy?(params[:isDefault]) && !portfolio.is_default
    end
    audit!("portfolios.update", portfolio, actingAs: current_actor.key, changed: portfolio.previous_changes.keys - %w[updated_at])
    render json: { portfolio: full_json(portfolio) }
  end

  # POST /api/portfolios/:id/reset {fields: ["headline", ...]}: drops those overrides so the
  # fields inherit the master copy again (every inheritable field when `fields` is omitted).
  def reset
    return unless (portfolio = owned_portfolio)
    fields = params.key?(:fields) ? string_list_param(:fields) : Portfolio::INHERITED
    unless fields && (fields - Portfolio::INHERITED).empty?
      return render_error("fields must be a list from: #{Portfolio::INHERITED.join(', ')}.", :unprocessable_content, "INVALID_FIELDS")
    end
    portfolio.update!(fields.index_with(nil))
    audit!("portfolios.reset", portfolio, actingAs: current_actor.key, fields:)
    render json: { portfolio: full_json(portfolio) }
  end

  # PUT /api/portfolios/:id/items/:itemId {state}: "pinned" always shows the item, "excluded"
  # never does, "auto" leaves it to the rules.
  def set_item
    return unless require_scalar_params!(:state)
    return unless (portfolio = owned_portfolio)
    state = params[:state].to_s
    return render_error("state must be one of: #{ITEM_STATES.join(', ')}.", :unprocessable_content, "INVALID_STATE") unless ITEM_STATES.include?(state)
    item = PortfolioItem.where(user_id: portfolio.library_user_id).find(params[:itemId].to_s)
    Portfolio.transaction do
      portfolio.lock!
      portfolio.pinned_item_ids = Array(portfolio.pinned_item_ids) - [item.id] + (state == "pinned" ? [item.id] : [])
      portfolio.excluded_item_ids = Array(portfolio.excluded_item_ids) - [item.id] + (state == "excluded" ? [item.id] : [])
      portfolio.save!
    end
    audit!("portfolios.item", portfolio, actingAs: current_actor.key, itemId: item.id, state:)
    render json: { portfolio: full_json(portfolio) }
  end

  def destroy
    return unless (portfolio = owned_portfolio)
    Portfolio.transaction do
      portfolio.destroy!
      # The owner keeps a default while they have any portfolio: the most recently updated one.
      if portfolio.is_default && (successor = Portfolio.owned_by(current_actor).order(updated_at: :desc, id: :asc).first)
        successor.make_default!
      end
    end
    audit!("portfolios.destroy", portfolio, actingAs: current_actor.key, title: portfolio.title)
    render json: { ok: true }
  end

  def make_default
    return unless (portfolio = owned_portfolio)
    Portfolio.transaction { portfolio.make_default! }
    audit!("portfolios.default", portfolio, actingAs: current_actor.key)
    render json: { portfolio: full_json(portfolio) }
  end

  # POST /api/portfolios/draft {goal, purpose?, title?}: a proposed portfolio built "by
  # elimination" from the acting identity's library. Nothing is saved; the client shows the
  # proposal, lets the person refine it and POSTs /api/portfolios with the result.
  def draft
    return unless (actor = current_actor)
    return unless require_scalar_params!(:goal, :purpose, :title)
    goal = params[:goal].to_s.strip
    purpose = params[:purpose].to_s.strip
    if goal.empty? && purpose.empty?
      return render_error("Describe what this portfolio is for.", :unprocessable_content, "GOAL_REQUIRED", fields: { goal: ["Describe what this portfolio is for."] })
    end
    return render_error("goal must be 500 characters or fewer.", :unprocessable_content, "INVALID_GOAL") if goal.length > 500
    return unless within_user_rate_limit?("portfolio-draft", limit: DRAFTS_PER_HOUR, period: 1.hour)

    library = Portfolio.library_for(actor.user? ? actor.id : actor.record.owner_id)
    render json: { draft: PortfolioDraft.new(goal: [purpose.tr("-", " "), goal].join(" "), title: params[:title].presence || goal.presence || purpose, purpose:).call(library) }
  end

  # The EPK page: a public or link-only portfolio whose owner is publicly visible. Only work
  # samples whose own visibility is public are shown.
  def public_show
    portfolio = Portfolio.with_owner.find_by(slug: params[:slug].to_s)
    return render_error("Portfolio not found", :not_found) unless portfolio&.publicly_readable?
    render json: { portfolio: portfolio.api_json(members: portfolio.members, public_view: true) }
  end

  private

  # The acting identity's portfolio named by :id (404 for anyone else's), or nil after rendering.
  def owned_portfolio
    return nil unless (actor = current_actor)
    Portfolio.owned_by(actor).with_owner.find(params[:id])
  end

  def full_json(portfolio) = portfolio.api_json(members: portfolio.members)

  # Copies the present fields onto the portfolio. Returns false after rendering 422 when an id
  # list is malformed or names an item outside the owner's library.
  def assign_fields(portfolio)
    PLAIN_FIELDS.each { |field| portfolio.public_send(:"#{field}=", params[field]) if params.key?(field) }
    OVERRIDE_TEXT.each { |field| portfolio.public_send(:"#{field}=", params[field].presence) if params.key?(field) }
    portfolio.genres = json_param(:genres) if params.key?(:genres)
    portfolio.rates = json_param(:rates) if params.key?(:rates)
    portfolio.rules = json_param(:rules) || {} if params.key?(:rules)
    lists = ID_LISTS.keys.select { params.key?(_1) }
    return true if lists.empty?

    library_ids = PortfolioItem.where(user_id: portfolio.library_user_id).pluck(:id)
    lists.each do |key|
      ids = params[key].nil? ? [] : string_list_param(key, max: Portfolio::MAX_LISTED_IDS)
      unless ids && (ids - library_ids).empty?
        render_error("#{key} must list work samples from this portfolio's library.", :unprocessable_content, "INVALID_ITEM", fields: { key => ["must list work samples from this portfolio's library"] })
        return false
      end
      portfolio.public_send(:"#{ID_LISTS[key]}=", ids)
    end
    true
  end

  def truthy?(value) = [true, "true", "1", 1].include?(value)
end
