# Median first-response time on urgent requests, in minutes/hours. Shared by the hirer
# day-14 inactive email, the hirer weekly digest, and the "fastest responders" ranking.
# The core computation mirrors FunnelQueries.median_first_response_minutes (this app's
# existing admin metric), scoped optionally to a city and/or a time window.
class ResponseTimeStats
  # Median minutes between an urgent request's creation and its first response, over
  # requests (optionally in `city`, optionally created in `since..`) that have a response.
  # Returns nil when there's no data — callers use that to skip rather than show a made-up number.
  def self.median_minutes(city: nil, since: nil)
    deltas(city:, since:).then { |d| median(d) }
  end

  def self.median_hours(city: nil, since: nil)
    minutes = median_minutes(city:, since:)
    return nil if minutes.nil?

    (minutes / 60.0).round(1)
  end

  # Per-responder median response minutes, for the "fastest responders this week" ranking.
  # Returns [[user_id, median_minutes], ...] sorted fastest first, only for responders with
  # at least one qualifying response in the window/city.
  def self.fastest_responders(city: nil, since: nil, limit: 3)
    requests = UrgentRequest.all
    requests = requests.where("city ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(city)}%") if city.present?
    requests = requests.where(created_at: since..) if since

    rows = UrgentRequestResponse.joins(:urgent_request).merge(requests)
      .pluck(:user_id, "urgent_request_responses.created_at", "urgent_requests.created_at")
    by_user = rows.group_by(&:first)
    by_user.filter_map do |user_id, entries|
      deltas = entries.map { |_, responded_at, requested_at| (responded_at - requested_at) / 60.0 }
      [user_id, median(deltas)]
    end.sort_by { |_, m| m }.first(limit)
  end

  def self.deltas(city:, since:)
    requests = UrgentRequest.all
    requests = requests.where("city ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(city)}%") if city.present?
    requests = requests.where(created_at: since..) if since

    first_response_at = UrgentRequestResponse.joins(:urgent_request).merge(requests)
      .group(:urgent_request_id).minimum(:created_at)
    return [] if first_response_at.empty?

    created_at = UrgentRequest.where(id: first_response_at.keys).pluck(:id, :created_at).to_h
    first_response_at.filter_map { |id, responded_at| ((responded_at - created_at[id]) / 60.0) if created_at[id] }
  end

  def self.median(values)
    return nil if values.blank?

    sorted = values.sort
    mid = sorted.length / 2
    (sorted.length.odd? ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2.0).round(1)
  end
  private_class_method :deltas, :median
end
