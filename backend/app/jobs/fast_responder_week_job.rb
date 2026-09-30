# Weekly: for each city, the 10 musicians with the best median first-response time on urgent
# requests this week (at least 2 responses that week) get a "fast_responder_week" badge, and the
# top names in each city are posted to The Stage as a system post. Runs Mondays (good_job.rb);
# idempotent via the unique (user, kind, awarded_for) index on badges and the posts' system_ref.
class FastResponderWeekJob < ApplicationJob
  queue_as :scheduled

  TOP_N = 10
  MIN_RESPONSES = 2
  TOP_NAMED_IN_POST = 5

  def perform(now = Time.current)
    week_end = now.beginning_of_week(:monday)
    week_start = week_end - 1.week
    awarded_for = Badge.iso_week(week_start)

    response_times_by_city(week_start, week_end).each do |city, rows|
      top = rows.select { _1[:count] >= MIN_RESPONSES }.sort_by { _1[:median_minutes] }.first(TOP_N)
      next if top.empty?

      top.each { award_badge(_1[:user_id], awarded_for) }
      post_leaderboard(city, top, awarded_for)
    end
  end

  private

  # { city => [{ user_id:, name:, count:, median_minutes: }, ...] }, grouped by the requester's
  # city on the urgent request (a responder's own reach spans cities, but the leaderboard is
  # local — "fastest responders in Mumbai" — because that is what the hiring city cares about).
  def response_times_by_city(week_start, week_end)
    # Synthetic QA and demo accounts never earn a badge or appear on the leaderboard.
    rows = UrgentRequestResponse.joins(:urgent_request, :user)
      .where(users: { synthetic_batch: nil }).where(urgent_requests: { requester_id: User.organic.select(:id) })
      .where(created_at: week_start...week_end)
      .pluck("urgent_requests.city", "urgent_request_responses.user_id", "users.name",
        Arel.sql("EXTRACT(EPOCH FROM (urgent_request_responses.created_at - urgent_requests.created_at)) / 60.0"))

    by_city_user = rows.group_by { |city, user_id, _name, _minutes| [city, user_id] }
    grouped = Hash.new { |h, k| h[k] = [] }
    by_city_user.each do |(city, user_id), entries|
      minutes = entries.map { _1[3] }
      grouped[city] << { user_id:, name: entries.first[2], count: entries.length, median_minutes: median(minutes) }
    end
    grouped
  end

  def median(values)
    sorted = values.sort
    mid = sorted.length / 2
    sorted.length.odd? ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2.0
  end

  def award_badge(user_id, awarded_for)
    Badge.find_or_create_by!(user_id:, kind: "fast_responder_week", awarded_for:)
  rescue ActiveRecord::RecordNotUnique
    nil
  end

  def post_leaderboard(city, top, awarded_for)
    names = top.first(TOP_NAMED_IN_POST).map { _1[:name] }
    Post.create!(author_type: "system", author_id: Post::SYSTEM_AUTHOR_ID, kind: "system", system_kind: "fastest_responders",
      system_ref: "fastest_responders:#{city}:#{awarded_for}", city:, visibility: "public", status: "active",
      body: "Fastest responders in #{city} this week: #{names.join(', ')}")
  rescue ActiveRecord::RecordNotUnique
    nil
  end
end
