# Read-side queries for the admin Funnel tab (Admin::FunnelController). Plain SQL/AR against
# product_events plus the existing booking/application/urgent-request tables — no new
# infrastructure, no third-party analytics. Every result is cached for CACHE_TTL so opening the
# tab repeatedly (or several admins at once) doesn't re-scan the events table each time.
class FunnelQueries
  CACHE_TTL = 5.minutes
  FUNNEL_STEPS = %w[landing_view path_chosen signup_completed first_action booking_or_urgent_filled].freeze
  FIRST_ACTION_NAMES = %w[job_posted profile_link_added].freeze

  # Product events from visitors and real accounts; events by synthetic QA and demo accounts are left out.
  def self.organic_events
    ProductEvent.where(user_id: nil).or(ProductEvent.where.not(user_id: User.synthetic.select(:id)))
  end

  def self.summary(days:)
    Rails.cache.fetch("funnel:summary:#{days}", expires_in: CACHE_TTL) do
      since = days.days.ago
      {
        windowDays: days,
        funnel: funnel(since),
        weekly: weekly_bookings_and_hires(since),
        medianFirstResponseMinutes: median_first_response_minutes(since),
        retentionWeek1: retention_week1(since)
      }
    end
  end

  # Distinct anon_id counts for each step, in order. Not a strict per-user join funnel (an anon_id
  # can appear in any order), but a fast, honest read of "how many distinct visitors reached at
  # least this step" — accurate enough to see where the drop-off is.
  # `until_time` (optional, exclusive) closes the window, for a single past week.
  def self.funnel(since, until_time = nil)
    events = organic_events.where(created_at: since...until_time)
    counts = events.where(name: %w[landing_view path_chosen signup_completed] + FIRST_ACTION_NAMES + %w[booking_quote_accepted urgent_response_submitted])
      .group(:name).distinct.count(:anon_id)
    booking_or_urgent = events.where(name: %w[booking_quote_accepted urgent_response_submitted]).distinct.count(:anon_id)
    first_action = events.where(name: FIRST_ACTION_NAMES).distinct.count(:anon_id)
    FUNNEL_STEPS.map do |step|
      value = case step
      when "first_action" then first_action
      when "booking_or_urgent_filled" then booking_or_urgent
      else counts[step] || 0
      end
      { step:, count: value }
    end
  end

  def self.weekly_bookings_and_hires(since)
    organic = User.organic.select(:id)
    bookings = BookingRequest.where(requester_id: organic, created_at: since..).group(Arel.sql("date_trunc('week', created_at)")).count
    hires = Application.where(candidate_id: organic, status: "Hired").where(updated_at: since..).group(Arel.sql("date_trunc('week', updated_at)")).count
    weeks = (bookings.keys + hires.keys).uniq.sort
    weeks.map { |week| { weekStart: week.to_date.iso8601, bookings: bookings[week] || 0, hires: hires[week] || 0 } }
  end

  # Median minutes between an urgent request's creation and its first response, over requests
  # created in the window that have at least one response.
  def self.median_first_response_minutes(since)
    organic = User.organic.select(:id)
    minutes = UrgentRequestResponse.joins(:urgent_request).where(user_id: organic, urgent_requests: { created_at: since.., requester_id: organic })
      .group(:urgent_request_id).minimum(:created_at)
      .map { |urgent_request_id, first_at| [urgent_request_id, first_at] }
    return nil if minutes.empty?

    request_created_at = UrgentRequest.where(id: minutes.map(&:first)).pluck(:id, :created_at).to_h
    deltas = minutes.filter_map { |id, first_at| ((first_at - request_created_at[id]) / 60.0) if request_created_at[id] }
    return nil if deltas.empty?

    sorted = deltas.sort
    mid = sorted.length / 2
    (sorted.length.odd? ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2.0).round(1)
  end

  # Of users whose first "signup_completed" event fell in week 1 of the window, the percent with
  # any product event 7-14 days after that signup.
  def self.retention_week1(since)
    signups = organic_events.where(name: "signup_completed", created_at: since..(since + 7.days)).where.not(user_id: nil)
      .group(:user_id).minimum(:created_at)
    return nil if signups.empty?

    returned = signups.count do |user_id, signed_up_at|
      ProductEvent.where(user_id:, created_at: (signed_up_at + 7.days)..(signed_up_at + 14.days)).exists?
    end
    ((returned.to_f / signups.size) * 100).round(1)
  end
end
