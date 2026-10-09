require "test_helper"
require "minitest/mock"

class RateLimitSpikeAlertJobTest < ActiveSupport::TestCase
  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @messages = []
    @reporter = ->(text, **options) { @messages << [text, options] }
  end

  teardown { Rails.cache = @original_cache }

  test "is scheduled every five minutes" do
    entry = Rails.application.config.good_job.cron.fetch(:rate_limit_spike_alert)
    assert_equal "*/5 * * * *", entry[:cron]
    assert_equal "RateLimitSpikeAlertJob", entry[:class]
  end

  test "sends one Sentry message per bucket at or above its threshold, for the last completed window" do
    now = Time.current
    previous = now - RateLimits.spike_window
    bump("otp-request", previous, RateLimits.spike_threshold("otp-request"))
    bump("search", previous, RateLimits.spike_threshold("search") - 1)
    bump("register", now, RateLimits.spike_threshold("register") + 10) # current window: not complete yet

    result = ErrorReporter.stub(:message, @reporter) { RateLimitSpikeAlertJob.perform_now(at: now) }

    assert_equal ["otp-request"], result[:spikes]
    assert_equal RateLimits.names.size, result[:checked]
    assert_equal 1, @messages.size
    text, options = @messages.first
    assert_match(/Rate-limit spike: #{RateLimits.spike_threshold('otp-request')} x 429 on otp-request/, text)
    assert_equal :warning, options[:level]
    assert_equal({ source: "rate_limit_spike", bucket: "otp-request" }, options[:tags])
    assert_equal ["rate_limit_spike", "otp-request"], options[:fingerprint]
    assert_equal RateLimits.spike_threshold("otp-request"), options[:count]
  end

  test "per-bucket thresholds override the default" do
    assert_operator RateLimits.spike_threshold("search"), :>, RateLimits.spike_threshold("register")
    assert_equal RateLimits.spike_alert.fetch(:threshold), RateLimits.spike_threshold("register")
  end

  test "a quiet window sends nothing, and a broken cache store is logged, not raised" do
    assert_empty ErrorReporter.stub(:message, @reporter) { RateLimitSpikeAlertJob.perform_now[:spikes] }
    Rails.cache = Class.new(ActiveSupport::Cache::Store) { def read(*) = raise(Errno::ECONNREFUSED) }.new
    assert_nothing_raised { RateLimitSpikeAlertJob.perform_now }
    assert_empty @messages
  end

  private

  def bump(bucket, at, times)
    Rails.cache.write(UserRateLimit.spike_counter_key(bucket, at), times)
  end
end
