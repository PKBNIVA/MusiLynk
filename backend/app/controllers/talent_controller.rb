class TalentController < ApplicationController
  include ScalarParams
  include ListPaging
  LIST_LIMIT = 200
  # The India-first facets (language, eventType, genre, budgetMax) are shared with /api/search.
  FACET_PARAMS = %i[language eventType genre budgetMax].freeze
  LIST_PARAMS = (%i[q location role instrument verified remoteRecording limit cursor] + FACET_PARAMS).freeze

  # Ranking rewards proof (plan 5.1.4): verified, then a playable public sample, then how complete the
  # profile is, then any published rate, then a recent sign-in. Those signals are precomputed into
  # profiles.rank_score (TalentRank) and indexed with the user id, so the unfiltered directory reads
  # its page off the index and pages by keyset on (rank_score, user_id). Ends in a unique column.
  LIST_ORDER = ["profiles.rank_score DESC", "profiles.user_id DESC"].freeze
  # The "from" price on a card is the lowest of these rates (tour-day pay is a different kind of engagement).
  FROM_RATE_SQL = "LEAST(NULLIF(profiles.session_rate, 0), NULLIF(profiles.show_rate, 0), NULLIF(profiles.day_rate, 0), NULLIF(profiles.hourly_rate, 0))".freeze
  # A role filter matches the name and headline (weight A) and roles, skills, instruments and genres (B).
  ROLE_WEIGHTS = "AB".freeze

  def public_index
    return unless require_scalar_params!(*LIST_PARAMS)
    render_listing(:talent, cache: :listing) { public_profile(_1) }
  end

  def public_show
    candidate = listing_scope.find(params[:id])
    items = candidate.portfolio_items.where(visibility: "public").order(featured: :desc, sort_order: :asc).to_a
    # One upload lookup for the profile photo, the work samples' images and their audio variants together.
    uploads = Upload.variants_by_url(PortfolioItem.image_urls(items) + PortfolioItem.audio_urls(items) + [candidate.profile&.photo_url]).to_a
    @image_sets = ImageSet.from_uploads(uploads)
    PortfolioItem.preload_image_sets(items, sets: @image_sets, audio: AudioSet.from_uploads(uploads))
    json = { professional: with_bookings(public_profile(candidate), candidate.id), portfolio: items.map(&:api_json) }.to_json
    return if public_cache!(:show, etag: json)
    render json: json
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
    render json: { candidate: with_bookings(public_profile(candidate), candidate.id), portfolio: PortfolioItem.preload_image_sets(candidate.portfolio_items.where(visibility: "public")).map(&:api_json) }
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
        "portfolio" => PortfolioItem.preload_image_sets(candidate.portfolio_items.where(visibility: "public").limit(8)).map(&:api_json),
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
  # `cache` names the edge-cache lifetime (PublicCaching) for the anonymous public listing.
  # Browsing (no `q`) pages by keyset on (rank_score, user_id); a typed search ranks by relevance first
  # and keeps the offset cursor. An offset cursor on a browse is still served for one release.
  def render_listing(key, cache: nil)
    position = list_position
    return render_invalid_cursor if position.nil?
    scope = filter(listing_scope.joins(:profile))
    limit = list_limit
    browsing = params[:q].blank?
    after = browsing ? keyset_condition(position) : nil
    deprecated_offset_cursor!("talent") if browsing && position[:offset].positive?
    offset = after ? 0 : position[:offset]
    search = Search::Runner.call(scope, params[:q], Search::Targets::TALENT, order: LIST_ORDER, offset:, limit:, after:)
    bookings = completed_bookings(search.rows.map(&:id))
    prime_profile_stats(search.rows, completed_bookings: bookings)
    next_cursor = if !search.more then nil
                  elsif browsing then encode_keyset_cursor(search.rows.last.profile.rank_score, search.rows.last.id)
                  else encode_list_cursor(offset + limit)
                  end
    body = { key => search.rows.map { with_bookings(yield(_1), _1.id, bookings) }, nextCursor: next_cursor, total: search.total }.merge(search.meta)
    if (role = role_filter)
      body[:role] = role
    end
    json = body.to_json
    return if cache && public_cache!(cache, etag: json)
    render json: json
  end

  # SQL: rows after the keyset position (rank_score DESC, user_id DESC), or nil without one.
  def keyset_condition(position)
    return nil unless position[:key]
    score, id = position[:key]
    ActiveRecord::Base.sanitize_sql_array(["(profiles.rank_score, profiles.user_id) < (?, ?)", score, id])
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
