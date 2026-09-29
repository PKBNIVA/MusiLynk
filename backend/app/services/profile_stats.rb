# Reviews summary, urgent-response time and this week's fast-responder badge for one user's
# public/talent card (see ApplicationController#public_profile).
class ProfileStats
  RESPONSE_TIME_WINDOW = 90.days
  MIN_RESPONSE_SAMPLES = 3

  def self.for(user) = new(user).to_h

  # { user_id => stats } for many users in a handful of queries, so lists (talent, candidates,
  # folders) do not run the four per-user lookups once per row.
  def self.batch(users)
    ids = users.map(&:id)
    return {} if ids.empty?
    reviews = Review.where(employer_id: ids, status: "published").group(:employer_id).pluck(:employer_id, Arel.sql("COUNT(*)"), Arel.sql("AVG(rating)"))
      .to_h { |id, count, avg| [id, [count, avg.to_f.round(2)]] }
    samples = Hash.new { |h, k| h[k] = [] }
    UrgentRequestResponse.joins(:urgent_request).where(user_id: ids, urgent_requests: { created_at: RESPONSE_TIME_WINDOW.ago.. })
      .pluck("urgent_request_responses.user_id", "urgent_request_responses.created_at", "urgent_requests.created_at")
      .each { |uid, responded, posted| samples[uid] << ((responded - posted) / 60.0) }
    badged = Badge.of_kind("fast_responder_week").current_week.where(user_id: ids).pluck(:user_id).to_set
    ids.to_h do |id|
      count, average = reviews.fetch(id, [0, nil])
      minutes = samples[id]
      [id, { "reviewsCount" => count, "reviewsAverage" => average,
        "responseTimeMinutes" => minutes.length < MIN_RESPONSE_SAMPLES ? nil : median_of(minutes).round,
        "fastResponderBadge" => badged.include?(id) }]
    end
  end

  def self.median_of(values)
    sorted = values.sort
    mid = sorted.length / 2
    sorted.length.odd? ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2.0
  end

  def initialize(user)
    @user = user
  end

  def to_h
    {
      "reviewsCount" => reviews_count,
      "reviewsAverage" => reviews_average,
      "responseTimeMinutes" => response_time_minutes,
      "fastResponderBadge" => fast_responder_this_week?
    }
  end

  private

  attr_reader :user

  def reviews_count = published_reviews.count

  def reviews_average
    count = reviews_count
    return nil if count.zero?
    (published_reviews.average(:rating).to_f).round(2)
  end

  def published_reviews = Review.where(employer_id: user.id, status: "published")

  # Median minutes between an urgent request being posted and this user's first response to
  # it, over the last 90 days — only shown once there are at least 3 data points (a single
  # fast reply should not read as a guarantee).
  def response_time_minutes
    minutes = UrgentRequestResponse.joins(:urgent_request)
      .where(user_id: user.id)
      .where(urgent_requests: { created_at: RESPONSE_TIME_WINDOW.ago.. })
      .pluck("urgent_request_responses.created_at", "urgent_requests.created_at")
      .map { |responded_at, posted_at| ((responded_at - posted_at) / 60.0) }
    return nil if minutes.length < MIN_RESPONSE_SAMPLES
    median(minutes).round
  end

  def fast_responder_this_week?
    Badge.of_kind("fast_responder_week").current_week.exists?(user_id: user.id)
  end

  def median(values) = self.class.median_of(values)
end
