class TalentController < ApplicationController
  include ScalarParams
  include ListPaging
  LIST_LIMIT = 200
  # The India-first facets (language, eventType, genre, budgetMax) are shared with /api/search.
  FACET_PARAMS = %i[language eventType genre budgetMax].freeze
  LIST_PARAMS = (%i[q location role instrument verified remoteRecording limit cursor] + FACET_PARAMS).freeze

  # Ranking rewards proof (plan 5.1.4): verified, then a playable public sample (audio or video with a link, not an image, PDF or project), then how complete the
  # profile is, then any published rate, then the most recent sign-in. An empty profile therefore never
  # outranks a populated one. COMPLETENESS mirrors the dashboard's profileScore (six signals, 0-6).
  HAS_SAMPLE_SQL = "EXISTS (SELECT 1 FROM portfolio_items ranked_samples WHERE ranked_samples.user_id = users.id AND ranked_samples.visibility = 'public' AND ranked_samples.kind IN ('audio', 'video') AND btrim(COALESCE(ranked_samples.url, '')) <> '')".freeze
  COMPLETENESS_SQL = [
    *%w[headline bio location].map { "(CASE WHEN btrim(COALESCE(profiles.#{_1}, '')) <> '' THEN 1 ELSE 0 END)" },
    *%w[skills genres].map { "(CASE WHEN profiles.#{_1} <> '[]'::jsonb THEN 1 ELSE 0 END)" },
    "(CASE WHEN EXISTS (SELECT 1 FROM portfolio_items scored_items WHERE scored_items.user_id = users.id) THEN 1 ELSE 0 END)"
  ].join(" + ").then { "(#{_1})" }.freeze
  # The "from" price on a card is the lowest of these rates (tour-day pay is a different kind of engagement).
  FROM_RATE_SQL = "LEAST(NULLIF(profiles.session_rate, 0), NULLIF(profiles.show_rate, 0), NULLIF(profiles.day_rate, 0), NULLIF(profiles.hourly_rate, 0))".freeze
  HAS_RATES_SQL = "(#{FROM_RATE_SQL} IS NOT NULL)".freeze
  # Tie-breaks after relevance, and the order of an unfiltered directory; ends in a unique column.
  LIST_ORDER = [
    "profiles.verified DESC", "#{HAS_SAMPLE_SQL} DESC", "#{COMPLETENESS_SQL} DESC", "#{HAS_RATES_SQL} DESC",
    "users.last_login_at DESC NULLS LAST", "users.created_at DESC", "users.id ASC"
  ].freeze
  # A role filter matches the name and headline (weight A) and roles, skills, instruments and genres (B).
  ROLE_WEIGHTS = "AB".freeze

  def public_index
    return unless require_scalar_params!(*LIST_PARAMS)
    render_listing(:talent) { public_profile(_1) }
  end

  def public_show
    candidate = listing_scope.find(params[:id])
    render json: { professional: with_bookings(public_profile(candidate), candidate.id), portfolio: candidate.portfolio_items.where(visibility: "public").order(featured: :desc, sort_order: :asc).map(&:api_json) }
  end

  def index
    return unless authenticate!("jobseeker", "employer")
    return unless require_scalar_params!(*LIST_PARAMS)
    shortlisted = TalentShortlist.where(employer: current_user).pluck(:candidate_id).to_set
    render_listing(:candidates) { public_profile(_1).merge(shortlisted: shortlisted.include?(_1.id)) }
  end

  def show
    return unless authenticate!("jobseeker", "employer")
    candidate = listing_scope.find(params[:id])
    RecentActivity.create!(user: current_user, kind: "profile_view", entity_id: candidate.id, label: candidate.name)
    render json: { candidate: with_bookings(public_profile(candidate), candidate.id), portfolio: candidate.portfolio_items.where(visibility: "public").map(&:api_json) }
  end

  def compare
    return unless authenticate!("jobseeker", "employer")
    return unless require_scalar_params!(:ids)
    ids = params[:ids].to_s.split(",").map(&:strip).reject(&:blank?).uniq.first(4)
    return render_error("Choose at least two musicians to compare.", :bad_request) if ids.length < 2
    shortlisted = TalentShortlist.where(employer: current_user, candidate_id: ids).pluck(:candidate_id).to_set
    professionals = listing_scope.where(id: ids).map do |candidate|
      availability = AvailabilityWindow.where(user: candidate, status: "available").where("end_at > ?", Time.current).order(:start_at).limit(5).map do |window|
        { startAt: window.start_at, endAt: window.end_at, status: window.status, city: window.city }
      end
      public_profile(candidate).merge(
        "portfolio" => candidate.portfolio_items.where(visibility: "public").limit(8).map(&:api_json),
        "availability" => availability,
        "shortlisted" => shortlisted.include?(candidate.id)
      )
    end
    render json: { professionals: }
  end

  def shortlist
    return unless authenticate!("jobseeker", "employer")
    return unless require_scalar_params!(:note)
    candidate = listing_scope.find(params[:id])
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

  # Narrows a talent scope (joined to :profile) by the India-first facets. Blank or malformed values
  # are ignored. `budgetMax` keeps people whose "from" rate is at or under it; people with no rate
  # published are left out, since their price is unknown.
  def self.apply_facets(scope, params)
    contains = ->(value) { "%#{ActiveRecord::Base.sanitize_sql_like(value.to_s.strip)}%" }
    scope = scope.where("profiles.languages::text ILIKE ?", contains.(params[:language])) if params[:language].present?
    scope = scope.where("profiles.event_types::text ILIKE :v OR profiles.open_to::text ILIKE :v", v: contains.(params[:eventType])) if params[:eventType].present?
    scope = scope.where("profiles.genres::text ILIKE ?", contains.(params[:genre])) if params[:genre].present?
    budget = Integer(params[:budgetMax].to_s.strip, 10, exception: false)
    budget&.positive? ? scope.where("#{FROM_RATE_SQL} <= ?", budget) : scope
  end

  private

  def public_scope = User.discoverable_talent.preload(:profile, :portfolio_items)

  # Browse/search listings hide synthetic QA accounts from real users (except badged demo-* batches);
  # synthetic viewers still see every batch.
  def listing_scope = current_user&.synthetic_batch.present? ? public_scope : SyntheticQa::Demo.publicly_listed(public_scope)

  # { owner_id => completed bookings across the acts they own }, for the "N bookings" on a card.
  def completed_bookings(ids)
    return {} if ids.empty?
    BookingRequest.where(status: "completed").joins(:act).where(acts: { owner_id: ids }).group("acts.owner_id").count
  end

  def with_bookings(profile, id, counts = nil) = profile.merge("bookingsCount" => (counts || completed_bookings([id])).fetch(id, 0))

  # One ranked page of professionals: `key` => rows, plus nextCursor, total and how the query was read.
  def render_listing(key)
    offset = list_offset
    return render_invalid_cursor if offset.nil?
    scope = filter(listing_scope.joins(:profile))
    limit = list_limit
    search = Search::Runner.call(scope, params[:q], Search::Targets::TALENT, order: LIST_ORDER, offset:, limit:)
    bookings = completed_bookings(search.rows.map(&:id))
    prime_profile_stats(search.rows, completed_bookings: bookings)
    body = { key => search.rows.map { with_bookings(yield(_1), _1.id, bookings) }, nextCursor: list_next_cursor(search, offset, limit), total: search.total }.merge(search.meta)
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
    scope = Search::Query.new(params[:location]).as_location.filter(scope, Search::Targets::TALENT)
    if params[:role].present?
      role = params[:role].to_s
      role_query = if (terms = Search::Taxonomy.talent_role_terms(role))
        Search::Query.new(role, tokens: [Search::Query::Token.new(text: role.downcase, words: terms, prefixes: [], location: false)])
      else
        Search::Query.new(role)
      end
      scope = role_query.restrict(ROLE_WEIGHTS).filter(scope, Search::Targets::TALENT)
    end
    scope = scope.where("profiles.instruments::text ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(params[:instrument])}%") if params[:instrument].present?
    scope = scope.where(profiles: { verified: true }) if params[:verified] == "true"
    scope = scope.where(profiles: { verified: true }).where(users: { id: Verification::Tier.pro_user_ids }) if params[:verified] == "pro"
    scope = scope.where(profiles: { remote_recording: true }) if params[:remoteRecording] == "true"
    self.class.apply_facets(scope, params)
  end
end
