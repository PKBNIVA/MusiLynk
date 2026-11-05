# A portfolio is a view over its owner's one library of work samples, for one purpose
# ("Session guitarist", "Live with my band"). Owned by a person or by a Page they run (owner_type
# is the ActorResolver type). Nothing is copied:
# - Membership is computed on read: items matching `rules` (ShowcaseRules), plus
#   `pinned_item_ids`, minus `excluded_item_ids`. A library is at most a few hundred items, so
#   this is cheap and never goes stale; there is no materialized entries table.
# - headline, bio, city, genres and rates are overrides. NULL inherits the master copy
#   (ShowcaseMaster: the profile, or the act/organization).
# The library is the portfolio_items of the owner: the person, or the person who owns the Page.
# A public or link-only portfolio has a page at /api/public/portfolios/:slug (the EPK).
class Portfolio < ApplicationRecord
  VISIBILITIES = %w[public link private].freeze
  # "hidden" is set only by moderators (Admin::ReportsController#moderate).
  STATUSES = %w[active hidden].freeze
  RATE_BASES = %w[hour session day show event project track song].freeze
  INHERITED = %w[headline bio city genres rates].freeze
  DIMS = %w[roles genres instruments kinds tags].freeze
  SORTS = %w[featured newest manual].freeze
  MAX_PER_OWNER = Limits.portfolios_per_owner
  MAX_LIBRARY = 500
  MAX_LISTED_IDS = 500
  MAX_GENRES = 20
  TEXT_LIMITS = { title: 120, purpose: 40, headline: 160, bio: 2_000, city: 120 }.freeze

  belongs_to :owner_user, class_name: "User", foreign_key: :owner_id, optional: true
  belongs_to :owner_organization, class_name: "Organization", foreign_key: :owner_id, optional: true
  belongs_to :owner_act, class_name: "Act", foreign_key: :owner_id, optional: true

  attribute :genres, :json
  attribute :rates, :json
  attribute :rules, :json, default: -> { {} }
  attribute :pinned_item_ids, :json, default: -> { [] }
  attribute :excluded_item_ids, :json, default: -> { [] }
  attribute :item_order, :json, default: -> { [] }

  normalizes :title, :headline, :city, :bio, with: ->(value) { value.to_s.strip.presence }
  # A short tag such as "session" or "film-scoring".
  normalizes :purpose, with: ->(value) { value.to_s.strip.parameterize.presence }

  validates :owner_type, inclusion: { in: PageDirectory::OWNER_TYPES }
  validates :owner_id, :title, :slug, presence: true
  validates :visibility, inclusion: { in: VISIBILITIES }
  validates :status, inclusion: { in: STATUSES }
  TEXT_LIMITS.each { |field, maximum| validates field, length: { maximum: } }
  validate :genres_are_short_strings
  validate :rates_are_well_formed
  validate :rules_are_well_formed
  validate :id_lists_are_well_formed

  before_validation :assign_slug, on: :create
  after_destroy_commit -> { ShowcaseSuggestion.where(target_type: "portfolio", target_id: id).delete_all }

  scope :owned_by, ->(actor) { where(owner_type: actor.type, owner_id: actor.id) }
  scope :with_owner, -> { preload({ owner_user: :profile }, :owner_organization, :owner_act) }

  # Portfolios whose library is `user_id`'s items: their own and those of Pages they own.
  scope :over_library_of, ->(user_id) {
    where(owner_type: "user", owner_id: user_id)
      .or(where(owner_type: "organization", owner_id: Organization.where(owner_id: user_id).select(:id)))
      .or(where(owner_type: "act", owner_id: Act.where(owner_id: user_id).select(:id)))
  }

  # { "roles" => [...], ..., "kinds" => [kind] } of one work sample.
  def self.facets_for(item)
    { "roles" => Array(item.roles), "genres" => Array(item.genres), "instruments" => Array(item.instruments),
      "tags" => Array(item.tags), "kinds" => [item.kind].compact }
  end

  def self.year_for(item) = item.year.to_i.positive? ? item.year : item.created_at&.year

  def self.slug_for(title)
    base = title.to_s.parameterize.first(60).delete_suffix("-").presence || "portfolio"
    # The random part keeps link-only portfolios unguessable.
    "#{base}-#{SecureRandom.alphanumeric(6).downcase}"
  end

  def owner
    case owner_type
    when "user" then owner_user
    when "organization" then owner_organization
    when "act" then owner_act
    end
  end

  # Whose work samples this portfolio draws on.
  def library_user_id
    owner_type == "user" ? owner_id : owner&.owner_id
  end

  def self.library_for(user_id)
    PortfolioItem.where(user_id:).order(featured: :desc, sort_order: :asc, created_at: :desc, id: :asc).limit(MAX_LIBRARY).to_a
  end

  def library = self.class.library_for(library_user_id)

  def rule_set = ShowcaseRules.new(rules, dims: DIMS, sorts: SORTS)
  def pinned?(item) = Array(pinned_item_ids).include?(item.id)
  def excluded?(item) = Array(excluded_item_ids).include?(item.id)
  def hidden? = status == "hidden"

  # [[item, "pinned" | "rule"], ...] in display order. `library` is the owner's items (pass it in
  # to share one load between several portfolios).
  def members(library = self.library)
    set = rule_set
    chosen = library.filter_map do |item|
      next if excluded?(item)
      if pinned?(item) then [item, "pinned"]
      elsif set.match?(self.class.facets_for(item), self.class.year_for(item)) then [item, "rule"]
      end
    end
    order_members(chosen, set.sort)
  end

  def member?(item) = !excluded?(item) && (pinned?(item) || rule_set.match?(self.class.facets_for(item), self.class.year_for(item)))

  # The value shown for an inheritable field: the override, or else the master copy.
  def effective(master = self.master)
    INHERITED.index_with { |field| self[field].nil? ? master[field] : self[field] }
  end

  def master = ShowcaseMaster.for(owner)
  def overridden = INHERITED.reject { self[_1].nil? }

  # Readable by anyone with the link: not private, not hidden by a moderator, and the owner itself
  # is publicly visible (an active account, an active organization or act).
  def publicly_readable?
    visibility != "private" && !hidden? && (page = owner).present? && PageDirectory.public?(page)
  end

  # Makes this the owner's only default. Call inside a transaction.
  def make_default!
    Portfolio.where(owner_type:, owner_id:, is_default: true).where.not(id:).update_all(is_default: false, updated_at: Time.current)
    update!(is_default: true)
  end

  # `members`: the computed items (from #members) to include with their source.
  # `public_view`: only items whose own visibility is public, and no management fields.
  def api_json(members: nil, public_view: false)
    master = self.master
    json = {
      id:, ownerType: owner_type, ownerId: owner_id, ownerName: owner&.name, title:, purpose:,
      **effective(master).transform_keys(&:to_sym), overridden:, visibility:, slug:, createdAt: created_at, updatedAt: updated_at
    }
    unless public_view
      json.merge!(master: master.slice(*INHERITED), rules:, pinnedItemIds: pinned_item_ids, excludedItemIds: excluded_item_ids,
        itemOrder: item_order, isDefault: is_default, status:)
    end
    return json unless members
    members = members.select { |item, _| item.visibility == "public" } if public_view
    PortfolioItem.preload_image_sets(members.map(&:first))
    json.merge(itemCount: members.length, items: members.map { |item, source| { itemId: item.id, source:, item: item.api_json } })
  end

  private

  def order_members(chosen, sort)
    case sort
    when "newest"
      chosen.sort_by { |item, _| [-(self.class.year_for(item) || 0), -item.created_at.to_f, item.id] }
    when "manual"
      rank = Array(item_order).each_with_index.to_h
      chosen.each_with_index.sort_by { |(item, _), index| rank.fetch(item.id, rank.length + index) }.map(&:first)
    else
      chosen # the library is already featured-first
    end
  end

  def assign_slug
    self.slug ||= self.class.slug_for(title)
  end

  def genres_are_short_strings
    return if genres.nil?
    unless genres.is_a?(Array) && genres.all? { _1.is_a?(String) && _1.strip.length.between?(1, 60) }
      return errors.add(:genres, "must be a list of genre names of up to 60 characters")
    end
    errors.add(:genres, "are limited to #{MAX_GENRES}") if genres.length > MAX_GENRES
  end

  def rates_are_well_formed
    return if rates.nil?
    return errors.add(:rates, "must be an object with min, max, currency and basis") unless rates.is_a?(Hash)
    value = rates.stringify_keys
    unknown = value.keys - %w[min max currency basis]
    return errors.add(:rates, "has unknown keys: #{unknown.join(', ')}") if unknown.any?
    min, max, currency, basis = value.values_at("min", "max", "currency", "basis")
    [min, max].each do |amount|
      errors.add(:rates, "min and max must be whole numbers from 0 to 100,000,000") unless amount.nil? || (amount.is_a?(Integer) && amount.between?(0, 100_000_000))
    end
    errors.add(:rates, "max must be at least min") if min.is_a?(Integer) && max.is_a?(Integer) && max < min
    errors.add(:rates, "currency must be a three-letter code such as INR") unless currency.nil? || currency.to_s.match?(/\A[A-Z]{3}\z/)
    errors.add(:rates, "basis must be one of: #{RATE_BASES.join(', ')}") unless basis.nil? || RATE_BASES.include?(basis)
  end

  def rules_are_well_formed
    rule_set.errors.each { errors.add(:rules, _1) }
  end

  def id_lists_are_well_formed
    { pinned_item_ids:, excluded_item_ids:, item_order: }.each do |field, list|
      valid = list.is_a?(Array) && list.length <= MAX_LISTED_IDS && list.all? { _1.is_a?(String) && _1.length <= 64 }
      errors.add(field, "must be a list of up to #{MAX_LISTED_IDS} item ids") unless valid
    end
  end
end
