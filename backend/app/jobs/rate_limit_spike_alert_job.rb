# Every 5 minutes (config/initializers/good_job.rb): for each bucket in config/rate_limits.yml,
# read the 429 counter of the last *completed* spike window (UserRateLimit.count_rejection bumps
# it on every 429) and send one Sentry message per bucket at or above its threshold
# (`spike_alert` in the config). Fingerprinted per bucket so a sustained attack is one issue
# with many events, not many issues. No-op without Sentry; never raises into GoodJob.
class RateLimitSpikeAlertJob < ApplicationJob
  queue_as :default

  def perform(at: Time.current)
    window = RateLimits.spike_window
    previous = at - window
    spikes = RateLimits.names.filter_map do |bucket|
      count = read_counter(bucket, previous)
      threshold = RateLimits.spike_threshold(bucket)
      next if count.nil? || count < threshold
      { bucket:, count:, threshold: }
    end
    spikes.each { |spike| alert(spike, previous, window) }
    { checked: RateLimits.names.size, spikes: spikes.map { _1[:bucket] } }
  end

  private

  def read_counter(bucket, window_start)
    Rails.cache.read(UserRateLimit.spike_counter_key(bucket, window_start))&.to_i
  rescue StandardError => error
    Rails.logger.warn({ event: "rate_limit_spike_read_failed", bucket:, error: error.class.name }.to_json)
    nil
  end

  def alert(spike, window_start, window)
    Rails.logger.warn({ event: "rate_limit_spike", **spike, windowStart: window_start.utc.iso8601, windowSeconds: window.to_i }.to_json)
    ErrorReporter.message("Rate-limit spike: #{spike[:count]} x 429 on #{spike[:bucket]} in #{window.to_i / 60} min (threshold #{spike[:threshold]})",
      level: :warning, tags: { source: "rate_limit_spike", bucket: spike[:bucket] }, fingerprint: ["rate_limit_spike", spike[:bucket]],
      count: spike[:count], threshold: spike[:threshold], windowStart: window_start.utc.iso8601)
  end
end
