# Fixed-window rate limits backed by Rails.cache (Solid Cache in PostgreSQL in production, or
# Redis when REDIS_URL is set), so counters are shared by every process and survive restarts.
# Every limit and window comes from config/rate_limits.yml (RateLimits); a call site names its
# bucket and nothing else. ApplicationController includes this, so every controller has it.
#
# Four shapes:
#   throttle!(bucket)                     per-IP count of every call; 429 over the limit
#   within_user_rate_limit?(bucket)       per-signed-in-user count of every call; 429 over the limit
#   failure_budget_exhausted?(bucket, scopes) / record_failure!(bucket, scopes)
#                                         callers check the budget before an attempt and spend it
#                                         only when the attempt fails (login, OTP verify)
#
# When the cache store cannot count (store down: its failsafe returns nil, or raises), a bucket
# marked `fail: closed` in the config answers 503 RATE_LIMIT_UNAVAILABLE so an outage never turns
# the guard off on OTP and password reset; every other bucket fails open so a cache outage never
# takes the site down. A NullStore (test/dev without a cache) is a deliberate configuration, not an
# outage, and always counts as open.
module UserRateLimit
  extend ActiveSupport::Concern

  CacheUnavailable = Class.new(StandardError)
  UNAVAILABLE_MESSAGE = "This step is temporarily unavailable. Try again in a minute.".freeze

  private

  # Returns true when the request may proceed; otherwise renders 429 and returns false.
  def throttle!(bucket, limit: nil, period: nil)
    period ||= RateLimits.period(bucket)
    limit ||= RateLimits.limit(bucket)
    key = "rate:#{bucket}:#{request.remote_ip}:#{Time.current.to_i / period.to_i}"
    count = rate_limit_count(bucket, key, 1, period)
    return false if count == :unavailable
    return true if count.nil? || count <= limit
    render_too_many_requests(bucket, period)
    false
  end

  # Returns true when the request may proceed; otherwise renders 429 and returns false.
  def within_user_rate_limit?(bucket, limit: nil, period: nil)
    period ||= RateLimits.period(bucket)
    limit ||= RateLimits.limit(bucket)
    key = "user-rate:#{bucket}:#{current_user.id}:#{Time.current.to_i / period.to_i}"
    count = rate_limit_count(bucket, key, 1, period)
    return false if count == :unavailable
    return true if count.nil? || count <= limit

    render_too_many_requests(bucket, period, message: "You're doing that too often. Try again later.", code: "RATE_LIMITED")
    false
  end

  # Failure-only throttling. `scopes` maps a scope name to the identifier (or to an
  # [identifier, limit] pair when the caller overrides the configured limit), e.g.
  # { email: address, ip: remote_ip }. Identifiers are hashed so cache keys never carry addresses.
  # Returns true (and renders 429) when any scope's budget is spent.
  def failure_budget_exhausted?(bucket, scopes, period: nil)
    period ||= RateLimits.period(bucket)
    exhausted = false
    scopes.each do |scope, value|
      identifier, limit = failure_scope(bucket, scope, value)
      next if identifier.blank?
      # Incrementing by zero is an atomic read that works on every cache store.
      count = rate_limit_count(bucket, failure_key(bucket, scope, identifier, period), 0, period)
      return true if count == :unavailable
      exhausted ||= (count || 0) >= limit
    end
    render_too_many_requests(bucket, period) if exhausted
    exhausted
  end

  def record_failure!(bucket, scopes, period: nil)
    period ||= RateLimits.period(bucket)
    scopes.each do |scope, value|
      identifier, _limit = failure_scope(bucket, scope, value)
      next if identifier.blank?
      rate_limit_count(bucket, failure_key(bucket, scope, identifier, period), 1, period)
    end
  end

  def failure_scope(bucket, scope, value)
    return value if value.is_a?(Array)
    [value, RateLimits.limit(bucket, scope)]
  end

  def failure_key(bucket, scope, identifier, period)
    "rate:#{bucket}:#{scope}:#{digest(identifier)}:#{Time.current.to_i / period.to_i}"
  end

  # The counter after adding `by`, nil when the store deliberately counts nothing (NullStore), or
  # :unavailable after rendering 503 when the store failed and the bucket fails closed. A failed
  # store on a fail-open bucket returns nil (admit) and logs once per request.
  def rate_limit_count(bucket, key, by, period)
    count = Rails.cache.increment(key, by, expires_in: period)
    return count unless count.nil?
    return nil if Rails.cache.is_a?(ActiveSupport::Cache::NullStore)
    rate_limit_store_failed(bucket, nil)
  rescue StandardError => error
    rate_limit_store_failed(bucket, error)
  end

  def rate_limit_store_failed(bucket, error)
    Rails.logger.error({ event: "rate_limit_store_unavailable", bucket:, error: error&.class&.name,
      failMode: RateLimits.fail_closed?(bucket) ? "closed" : "open" }.to_json)
    return nil unless RateLimits.fail_closed?(bucket)

    ErrorReporter.capture(error || CacheUnavailable.new("rate-limit counter unavailable"),
      tags: { source: "rate_limit_store", bucket: }, fingerprint: ["rate_limit_store_unavailable", bucket.to_s])
    response.set_header("Retry-After", "60")
    render_error(UNAVAILABLE_MESSAGE, :service_unavailable, "RATE_LIMIT_UNAVAILABLE")
    :unavailable
  end

  SPIKE_COUNTER_PREFIX = "rate429".freeze

  # Every 429 also bumps a per-bucket counter for the current spike window, read by
  # RateLimitSpikeAlertJob. Best effort: a failing store never changes the answer.
  def render_too_many_requests(bucket = nil, period = nil, message: "Too many requests. Try again later.", code: nil)
    if period
      response.set_header("Retry-After", (period.to_i - (Time.current.to_i % period.to_i)).to_s)
    end
    UserRateLimit.count_rejection(bucket) if bucket
    render_error(message, :too_many_requests, code)
  end

  def self.spike_counter_key(bucket, at = Time.current)
    window = RateLimits.spike_window.to_i
    "#{SPIKE_COUNTER_PREFIX}:#{bucket}:#{at.to_i / window}"
  end

  def self.count_rejection(bucket)
    Rails.cache.increment(spike_counter_key(bucket), 1, expires_in: RateLimits.spike_window * 3)
  rescue StandardError
    nil
  end
end
