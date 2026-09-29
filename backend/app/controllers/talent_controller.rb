class TalentController < ApplicationController
  include ScalarParams
  include ListPaging
  LIST_LIMIT = 200
  LIST_PARAMS = %i[q location role instrument verified remoteRecording limit cursor].freeze
  # Tie-breaks after relevance, and the order of an unfiltered directory; ends in a unique column.
  LIST_ORDER = ["profiles.verified DESC", "users.created_at DESC", "users.id ASC"].freeze
  ROLE_FIELDS = Search::Query::Fields.new(primary: ["profiles.roles::text", "profiles.headline"], secondary: ["profiles.skills::text"], tertiary: [], location: [])
  LOCATION_FIELDS = Search::Query::Fields.new(primary: [], secondary: [], tertiary: [], location: ["profiles.location"])

  def public_index
    return unless require_scalar_params!(*LIST_PARAMS)
    render_listing(:talent) { public_profile(_1) }
  end

  def public_show
    candidate = public_scope.find(params[:id])
    render json: { professional: public_profile(candidate), portfolio: candidate.portfolio_items.where(visibility: "public").order(featured: :desc, sort_order: :asc).map(&:api_json) }
  end

  def index
    return unless authenticate!("jobseeker", "employer")
    return unless require_scalar_params!(*LIST_PARAMS)
    shortlisted = TalentShortlist.where(employer: current_user).pluck(:candidate_id).to_set
    render_listing(:candidates) { public_profile(_1).merge(shortlisted: shortlisted.include?(_1.id)) }
  end

  def show
    return unless authenticate!("jobseeker", "employer")
    candidate = public_scope.find(params[:id])
    RecentActivity.create!(user: current_user, kind: "profile_view", entity_id: candidate.id, label: candidate.name)
    render json: { candidate: public_profile(candidate), portfolio: candidate.portfolio_items.where(visibility: "public").map(&:api_json) }
  end

  def compare
    return unless authenticate!("jobseeker", "employer")
    return unless require_scalar_params!(:ids)
    ids = params[:ids].to_s.split(",").map(&:strip).reject(&:blank?).uniq.first(4)
    return render_error("Choose at least two professionals to compare.", :bad_request) if ids.length < 2
    professionals = public_scope.where(id: ids).map do |candidate|
      availability = AvailabilityWindow.where(user: candidate, status: "available").where("end_at > ?", Time.current).order(:start_at).limit(5).map do |window|
        { startAt: window.start_at, endAt: window.end_at, status: window.status, city: window.city }
      end
      public_profile(candidate).merge(
        "portfolio" => candidate.portfolio_items.where(visibility: "public").limit(8).map(&:api_json),
        "availability" => availability
      )
    end
    render json: { professionals: }
  end

  def shortlist
    return unless authenticate!("jobseeker", "employer")
    return unless require_scalar_params!(:note)
    candidate = public_scope.find(params[:id])
    TalentShortlist.transaction do
      current_user.lock!
      unless TalentShortlist.exists?(employer: current_user, candidate:)
        Entitlements.for(current_user).ensure_capacity!(:shortlist, TalentShortlist.where(employer: current_user).count)
      end
      TalentShortlist.find_or_create_by!(employer: current_user, candidate:) { _1.note = params[:note] }
    end
    render json: { ok: true }, status: :created
  rescue Entitlements::LimitReached => error
    render_error(error.message, :payment_required, Entitlements::ERROR_CODE)
  end

  def unshortlist
    return unless authenticate!("jobseeker", "employer")
    TalentShortlist.where(employer: current_user, candidate_id: params[:id]).delete_all
    render json: { ok: true }
  end

  def recent
    return unless authenticate!("jobseeker", "employer")
    render json: { items: RecentActivity.where(user: current_user).order(created_at: :desc).limit(30).as_json.map { _1.transform_keys { |key| key.camelize(:lower) } } }
  end

  def clear_recent
    return unless authenticate!("jobseeker", "employer")
    RecentActivity.where(user: current_user).delete_all
    render json: { ok: true }
  end

  def employers
    return unless authenticate!
    render json: { employers: User.employer.active.includes(:profile).order(:name).limit(LIST_LIMIT).map { public_employer(_1) } }
  end

  private

  def public_scope = User.discoverable_talent.preload(:profile, :portfolio_items)

  # Browse/search listings hide synthetic QA accounts from real users (except badged demo-* batches);
  # synthetic viewers still see every batch.
  def listing_scope = current_user&.synthetic_batch.present? ? public_scope : SyntheticQa::Demo.publicly_listed(public_scope)

  # One ranked page of professionals: `key` => rows, plus nextCursor, total and how the query was read.
  def render_listing(key)
    offset = list_offset
    return render_invalid_cursor if offset.nil?
    scope = filter(listing_scope.joins(:profile))
    limit = list_limit
    search = Search::Runner.call(scope, params[:q], Search::Targets::TALENT, order: LIST_ORDER, offset:, limit:)
    body = { key => search.rows.map { yield _1 }, nextCursor: list_next_cursor(search, offset, limit), total: search.total }.merge(search.meta)
    if (role = role_filter)
      body[:role] = role
    end
    render json: body
  end

  # A landing-page role group ("performer") or a free-text role, as { key:, label: }.
  def role_filter
    return nil if params[:role].blank?
    key = Search::Taxonomy.talent_roles.keys.find { _1.casecmp?(params[:role].to_s.strip) }
    key ? { key:, label: Search::Taxonomy.talent_roles[key][:label] } : { key: params[:role].to_s.strip, label: params[:role].to_s.strip }
  end

  def filter(scope)
    scope = Search::Query.new(params[:location]).filter(scope, LOCATION_FIELDS)
    if params[:role].present?
      role = params[:role].to_s
      role_query = if (terms = Search::Taxonomy.talent_role_terms(role))
        Search::Query.new(role, tokens: [Search::Query::Token.new(text: role.downcase, words: terms, prefixes: [], location: false)])
      else
        Search::Query.new(role)
      end
      scope = role_query.filter(scope, ROLE_FIELDS)
    end
    scope = scope.where("profiles.instruments::text ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(params[:instrument])}%") if params[:instrument].present?
    scope = scope.where(profiles: { verified: true }) if params[:verified] == "true"
    scope = scope.where(profiles: { verified: true }).where("users.id IN (#{Verification::Tier.pro_user_ids_sql})") if params[:verified] == "pro"
    scope = scope.where(profiles: { remote_recording: true }) if params[:remoteRecording] == "true"
    scope
  end
end
