# Self-hosted funnel analytics ingest (see src/app/lib/analytics.ts). No third-party analytics:
# this is the whole store. Public (anonymous or signed-in), rate-limited by IP, a small batch at a
# time, allow-listed event names only, and each event capped at 1KB once serialized — so nothing
# arbitrary (an email, a message body, a stray large payload) ever lands here.
class EventsController < ApplicationController
  MAX_BATCH = 25
  MAX_EVENT_BYTES = 1_024
  RATE_LIMIT_PER_MINUTE = 120

  # Every name analytics.ts (and the steps documented for the landing/signup pages in
  # backend/docs/analytics.md) is allowed to send. Anything else is dropped, not stored.
  ALLOWED_NAMES = %w[
    landing_view path_chosen
    signup_started signup_completed
    auth_google_start auth_google_success
    profile_link_added
    job_posted
    urgent_request_submitted urgent_response_submitted
    booking_quote_sent booking_quote_accepted booking_deposit_paid
    route_change
    profile_view
    share_card_download share_whatsapp
  ].freeze

  def create
    return unless throttle!("events", limit: RATE_LIMIT_PER_MINUTE, period: 1.minute)

    events = Array(params[:events])
    return render_error("events must be a non-empty array.", :unprocessable_content, "INVALID_EVENTS") if events.blank?
    return render_error("A batch is at most #{MAX_BATCH} events.", :unprocessable_content, "BATCH_TOO_LARGE") if events.size > MAX_BATCH

    rows = events.filter_map { |raw| build_row(raw) }
    ProductEvent.insert_all(rows) if rows.any?
    check_profile_view_milestones(rows)
    render json: { ok: true, accepted: rows.size, dropped: events.size - rows.size }
  end

  private

  # A profile_view crossing exactly 100 views triggers a one-off milestone email to the
  # profile's owner (Notifier.milestone_profile_100_views is itself idempotent).
  def check_profile_view_milestones(rows)
    rows.each do |row|
      next unless row[:name] == "profile_view"

      profile_id = row.dig(:props, "profileId")
      next if profile_id.blank?

      user = User.find_by(id: profile_id)
      next unless user

      count = ProductEvent.named("profile_view").where("props->>'profileId' = ?", profile_id).count
      Notifier.milestone_profile_100_views(user, count)
    end
  end

  # Silently drops anything that doesn't fit the allow-list or size cap (never a 4xx for one bad
  # event in an otherwise good batch — the client fires-and-forgets these).
  def build_row(raw)
    return nil unless raw.is_a?(ActionController::Parameters) || raw.is_a?(Hash)

    event = raw.is_a?(ActionController::Parameters) ? raw.permit!.to_h : raw
    name = event["name"].to_s
    anon_id = event["anonId"].to_s
    return nil unless ALLOWED_NAMES.include?(name) && anon_id.present? && anon_id.length <= 100

    props = event["props"].is_a?(Hash) ? scrub_props(event["props"]) : {}
    row = {
      id: "prod_#{SecureRandom.uuid}", user_id: current_user&.id, anon_id: anon_id.first(100), name:,
      props:, page: event["page"].to_s.first(300).presence, referrer: event["referrer"].to_s.first(300).presence,
      city: event["city"].to_s.first(100).presence, created_at: Time.current
    }
    return nil if row.to_json.bytesize > MAX_EVENT_BYTES

    row
  end

  # Never an email or free text: values are coerced to strings/numbers/booleans and truncated, and
  # any key that looks like it might hold an email is dropped outright.
  EMAIL_LIKE = /email|@/i
  def scrub_props(props)
    props.each_with_object({}) do |(key, value), out|
      key = key.to_s.first(60)
      next if key.blank? || key.match?(EMAIL_LIKE)

      out[key] = case value
      when String then value.first(200)
      when Numeric, TrueClass, FalseClass then value
      end
    end.compact
  end
end
