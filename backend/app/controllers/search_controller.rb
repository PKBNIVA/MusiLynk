class SearchController < ApplicationController
  include ListPaging
  RESULT_TYPES = %w[jobs talent acts samples].freeze
  # Search is public, so bound the work one request can ask for: queries are cut to
  # MAX_QUERY_LENGTH characters and each IP gets REQUESTS_PER_MINUTE searches.
  MAX_QUERY_LENGTH = Search::Query::MAX_LENGTH
  REQUESTS_PER_MINUTE = 60
  MAX_RESULTS = 60
  # "All" takes at most this many of each type (then fair-shares MAX_RESULTS between them).
  PER_TYPE = 30
  ORDERS = {
    "jobs" => JobsController::LIST_ORDER,
    "talent" => TalentController::LIST_ORDER,
    "acts" => ActsController::LIST_ORDER,
    "samples" => ["portfolio_items.featured DESC", "portfolio_items.updated_at DESC", "portfolio_items.id ASC"]
  }.freeze
  TARGETS = { "jobs" => Search::Targets::JOBS, "talent" => Search::Targets::TALENT, "acts" => Search::Targets::ACTS, "samples" => Search::Targets::SAMPLES }.freeze
  # Popular searches repeat, and results are public, so each process keeps a response for
  # SEARCH_CACHE_SECONDS (default 60; 0 turns it off, as in tests). New listings appear within that.
  RESULTS_CACHE = ActiveSupport::Cache::MemoryStore.new(size: 32.megabytes)
  class_attribute :cache_seconds, default: Integer(ENV.fetch("SEARCH_CACHE_SECONDS", Rails.env.test? ? "0" : "60"), 10)

  # GET /search?q=&type=
  # Without `type`: up to PER_TYPE of each type, fair-shared into MAX_RESULTS, with per-type
  # `totals` and `moreOf` (true when a type has more than it shows; the UI links to that type).
  # With `type`: one type, paged with `limit`/`cursor` like the lists (`nextCursor`, `total`).
  # Every response says how the query was read: interpretedAs, matchMode, didYouMean.
  def index
    return unless throttle!("search", limit: REQUESTS_PER_MINUTE, period: 1.minute)
    return render_error("Search filters must be plain text.", :bad_request, "INVALID_PARAMETER") unless %i[q type limit cursor].all? { params[_1].nil? || params[_1].is_a?(String) }

    query = Search::Query.new(params[:q].to_s.strip.first(MAX_QUERY_LENGTH).strip)
    return render json: search_response([], query) if query.blank?

    type = RESULT_TYPES.include?(params[:type]) ? params[:type] : nil
    offset = type ? list_offset : 0
    return render_invalid_cursor if offset.nil?
    limit = type ? list_limit : PER_TYPE
    key = [synthetic_viewer?, query.natural?, query.text, type, offset, limit]
    render json: cached(key) { type ? type_response(type, query, offset, limit) : all_response(query) }
  end

  # GET /search/status
  def status = render(json: status_payload)

  private

  def cached(key, &block)
    return yield unless cache_seconds.positive?
    RESULTS_CACHE.fetch(["search", *key].join("\u0000"), expires_in: cache_seconds.seconds, &block)
  end

  def all_response(query)
    searches = RESULT_TYPES.index_with { run(_1, query, 0, PER_TYPE) }
    groups = searches.map { |type, search| search.rows.map { |row| present(type, row) } }
    results = combine(groups)
    shown = results.group_by { _1[:type] }.transform_values(&:size)
    totals = searches.transform_values(&:total)
    lead = searches.values.find { _1.total.positive? && _1.mode == "all" } || searches.values.find { _1.total.positive? } || searches.values.first
    search_response(results, lead.query, lead).merge(totals:, moreOf: totals.to_h { |type, total| [type, total > shown.fetch(type, 0)] })
  end

  def type_response(type, query, offset, limit)
    search = run(type, query, offset, limit)
    search_response(search.rows.map { present(type, _1) }, search.query, search).merge(
      totals: { type => search.total }, nextCursor: list_next_cursor(search, offset, limit), total: search.total
    )
  end

  def run(type, query, offset, limit)
    Search::Runner.call(scope_for(type), query, TARGETS.fetch(type), order: ORDERS.fetch(type), offset:, limit:)
  end

  # Every type with matches gets a fair share of the MAX_RESULTS slots before any type
  # fills the rest, so a broad query cannot push acts and samples out of "All".
  # Results stay grouped by type, in the order the groups were given.
  def combine(groups)
    share = MAX_RESULTS / [groups.size, 1].max
    taken = groups.map { _1.first(share) }
    spare = MAX_RESULTS - taken.sum(&:size)
    groups.each_with_index do |group, index|
      extra = group.drop(share).first(spare)
      taken[index] += extra
      spare -= extra.size
    end
    taken.flatten(1)
  end

  def scope_for(type)
    scope = case type
    when "jobs" then Job.published.joins(:employer).includes(:employer)
    when "talent" then User.discoverable_talent.joins(:profile).preload(:profile)
    when "acts" then Act.joins(:owner).includes(:owner).where(status: "active")
    else PortfolioItem.joins(user: :profile).includes(:user).where(visibility: "public", users: { status: "active", profile_complete: true })
    end
    synthetic_viewer? ? scope : SyntheticQa::Demo.publicly_listed(scope)
  end

  def present(type, row)
    case type
    when "jobs"
      { type:, id: row.id, demo: SyntheticQa::Demo.user?(row.employer), url: "/opportunities/#{row.id}", title: row.title,
        subtitle: [row.company, row.location].compact.join(" · "), description: row.description,
        tags: [row.opportunity_kind, row.function_area, row.workplace, row.genre, *row.skills].compact.uniq }
    when "talent"
      profile = row.profile
      { type:, id: row.id, demo: SyntheticQa::Demo.user?(row), url: "/professionals/#{row.id}", title: row.name,
        subtitle: [profile.headline, profile.location].compact.join(" · "), description: profile.bio,
        tags: [*profile.roles, *profile.skills, *profile.genres, *profile.instruments].compact.uniq }
    when "acts"
      { type:, id: row.id, demo: SyntheticQa::Demo.user?(row.owner), url: "/acts/#{row.id}", title: row.name,
        subtitle: [row.act_type, row.city].compact.join(" · "), description: row.tagline.presence || row.bio,
        tags: [row.act_type, *row.genres, *row.event_types].compact.uniq }
    else
      { type:, id: row.id, demo: SyntheticQa::Demo.user?(row.user), url: "/professionals/#{row.user_id}", title: row.title,
        subtitle: [row.user.name, row.credited_as].compact.join(" · "), description: row.description,
        tags: [row.kind, *row.tags, *row.genres, *row.roles, *row.instruments].compact.uniq }
    end
  end

  # Synthetic QA accounts are hidden from real users (except badged demo-* batches) but remain
  # discoverable to other synthetic accounts.
  def synthetic_viewer? = current_user&.synthetic_batch.present?

  def search_response(results, query, search = nil)
    { results:, interpretedAs: query.interpreted_as, matchMode: search&.mode, didYouMean: search&.did_you_mean,
      provider: "postgresql", status: status_payload }.compact
  end

  def status_payload = { provider: "postgresql", healthy: true, fallback: false }
end
