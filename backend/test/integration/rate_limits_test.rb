require "test_helper"

# Every rate limit comes from config/rate_limits.yml (RateLimits) through the UserRateLimit
# concern. These tests pin: the config's shape, that each stranger-callable endpoint answers 429
# at exactly its configured limit, the Retry-After header, the 429 spike counter, and the two fail
# modes when the cache store cannot count (closed for OTP and password reset, open elsewhere).
class RateLimitsTest < ActionDispatch::IntegrationTest
  IP = "203.0.113.9".freeze

  # A store whose every operation raises, standing in for Redis or Solid Cache being down.
  class BrokenStore < ActiveSupport::Cache::Store
    def increment(*) = raise(Errno::ECONNREFUSED, "cache down")
    def read(*) = raise(Errno::ECONNREFUSED, "cache down")
    def write(*) = raise(Errno::ECONNREFUSED, "cache down")
  end

  # A store whose failsafe swallowed the error and answered nil, as the Redis and Solid Cache
  # stores do by default.
  class SilentStore < ActiveSupport::Cache::Store
    def increment(*) = nil
    def read(*) = nil
    def write(*) = true
  end

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  test "the config names every bucket a controller uses, with a window and a limit or scopes" do
    used = Dir[Rails.root.join("app/controllers/**/*.rb")].flat_map do |file|
      File.read(file).scan(/(?:throttle!|within_user_rate_limit\?|failure_budget_exhausted\?|record_failure!|RateLimits\.(?:limit|period))\("([\w.-]+)"/).flatten
    end.uniq
    missing = used - RateLimits.names
    assert_empty missing, "buckets used in controllers but absent from config/rate_limits.yml"
    RateLimits.names.each do |name|
      rule = RateLimits.rule(name)
      assert_operator rule.fetch(:period_seconds).to_i, :>, 0, "#{name} needs a positive period_seconds"
      assert rule.key?(:limit) ^ rule.key?(:scopes), "#{name} needs exactly one of limit / scopes"
      assert_includes [nil, "open", "closed"], rule[:fail]&.to_s, "#{name} fail must be open or closed"
    end
    assert_raises(RateLimits::UnknownBucket) { RateLimits.limit("no-such-bucket") }
  end

  test "OTP request and verify, phone OTP and password reset fail closed; everything else fails open" do
    closed = RateLimits.names.select { RateLimits.fail_closed?(_1) }
    assert_equal %w[otp-request otp-verify-failure password-reset phone-otp-request phone-otp-verify-failure reset-password-token].sort, closed.sort
  end

  # Stranger-callable endpoints where the per-IP throttle is the first check, so a minimal body
  # reaches it: each must answer 429 on request limit+1 and carry Retry-After.
  PUBLIC_THROTTLES = {
    "register" => [:post, "/api/auth/register", {}],
    "password-reset" => [:post, "/api/auth/forgot-password", { email: "nobody@example.com" }],
    "reset-password-token" => [:get, "/api/auth/reset-password/check", { token: "x" }],
    "resend-verification" => [:post, "/api/auth/resend-verification", { email: "nobody@example.com" }],
    "search" => [:get, "/api/search", { q: "drums" }],
    "search-suggest" => [:get, "/api/search/suggest", { q: "dr" }],
    "events" => [:post, "/api/events", { name: "page_view" }],
    "link-preview" => [:post, "/api/link-previews", { url: "https://example.com" }],
    "link-import-draft" => [:post, "/api/link-import/draft", { url: "https://example.com" }],
    "act-invite-token" => [:get, "/api/act-invites/preview", { token: "nope" }]
  }.freeze

  PUBLIC_THROTTLES.each do |bucket, (verb, path, body)|
    test "#{bucket} answers 429 after #{bucket}'s configured limit from one IP" do
      limit = RateLimits.limit(bucket)
      limit.times do
        public_send(verb, path, params: body, env: { "REMOTE_ADDR" => IP }, as: :json)
        assert_not_equal 429, response.status, "#{bucket}: throttled before its limit"
      end
      public_send(verb, path, params: body, env: { "REMOTE_ADDR" => IP }, as: :json)
      assert_response :too_many_requests
      assert_equal "Too many requests. Try again later.", response.parsed_body["error"]
      assert_operator response.headers["Retry-After"].to_i, :>, 0
      # Another network is unaffected.
      public_send(verb, path, params: body, env: { "REMOTE_ADDR" => "198.51.100.1" }, as: :json)
      assert_not_equal 429, response.status
    end
  end

  test "a share card is served up to its limit per IP and then 429s" do
    user = User.create!(name: "Shared", email: "shared@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    user.create_profile!(verified: true, share_verification_publicly: true)
    RateLimits.limit("share-card").times do
      get "/share-cards/verified/#{user.id}.svg", env: { "REMOTE_ADDR" => IP }
      assert_response :success
    end
    get "/share-cards/verified/#{user.id}.svg", env: { "REMOTE_ADDR" => IP }
    assert_response :too_many_requests
    assert_equal "Too many requests. Try again later.", response.parsed_body["error"]
  end

  test "problem reports: signed-out IP per hour and per day, per address and site-wide caps come from the config" do
    assert_equal RateLimits.limit("problem-report-ip"), ProblemReportsController::SIGNED_OUT_IP_PER_HOUR
    assert_equal RateLimits.limit("problem-report-ip-day"), ProblemReportsController::SIGNED_OUT_IP_PER_DAY
    assert_equal RateLimits.limit("problem-report-email"), ProblemReportsController::SIGNED_OUT_EMAIL_PER_DAY
    assert_equal RateLimits.limit("problem-report-site"), ProblemReportsController::SIGNED_OUT_SITE_PER_DAY
    assert_equal RateLimits.limit("problem-report-ip-signed-in"), ProblemReportsController::SIGNED_IN_IP_PER_HOUR
    assert_equal RateLimits.limit("problem-report"), ProblemReportsController::SIGNED_IN_PER_HOUR
  end

  test "OTP request budget per email and per IP, and OTP verify failures per IP, come from the config" do
    assert_equal RateLimits.limit("otp-request", :email), AuthController::OTP_REQUESTS_PER_EMAIL
    assert_equal RateLimits.limit("otp-request", :ip), AuthController::OTP_REQUESTS_PER_IP
    assert_equal RateLimits.period("otp-request"), AuthController::OTP_REQUEST_PERIOD
    assert_equal RateLimits.limit("otp-verify-failure", :ip), AuthController::OTP_VERIFY_FAILURES_PER_IP
    assert_equal RateLimits.limit("login-failure", :email_ip), AuthController::LOGIN_FAILURES_PER_EMAIL_AND_IP
    assert_equal RateLimits.limit("search-suggest"), 120
  end

  test "an OTP request answers 429 at the per-email limit even from different IPs" do
    with_email_delivery do
      RateLimits.limit("otp-request", :email).times do |i|
        post "/api/auth/otp/request", params: { email: "budget@example.com" }, env: { "REMOTE_ADDR" => "10.0.0.#{i + 1}" }, as: :json
        assert_response :success
      end
      post "/api/auth/otp/request", params: { email: "budget@example.com" }, env: { "REMOTE_ADDR" => "10.0.0.99" }, as: :json
      assert_response :too_many_requests
      assert_operator response.headers["Retry-After"].to_i, :>, 0
    end
  end

  test "OTP verify failures are budgeted per IP and the verify endpoint answers 429 past it" do
    RateLimits.limit("otp-verify-failure", :ip).times do
      post "/api/auth/otp/verify", params: { email: "nobody@example.com", code: "000000" }, env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :unauthorized
    end
    post "/api/auth/otp/verify", params: { email: "nobody@example.com", code: "000000" }, env: { "REMOTE_ADDR" => IP }, as: :json
    assert_response :too_many_requests
  end

  test "every 429 bumps the spike counter for its bucket in the current window" do
    (RateLimits.limit("search") + 2).times { get "/api/search", params: { q: "x" }, env: { "REMOTE_ADDR" => IP } }
    assert_equal 2, Rails.cache.read(UserRateLimit.spike_counter_key("search"))
  end

  # ---- fail modes ----

  [["raises", -> { BrokenStore.new }], ["answers nil", -> { SilentStore.new }]].each do |label, store|
    test "when the cache store #{label}, OTP request answers 503 and sends no code (fail closed)" do
      Rails.cache = store.call
      with_email_delivery do
        assert_no_enqueued_jobs do
          post "/api/auth/otp/request", params: { email: "someone@example.com" }, env: { "REMOTE_ADDR" => IP }, as: :json
        end
      end
      assert_response :service_unavailable
      assert_equal "RATE_LIMIT_UNAVAILABLE", response.parsed_body["code"]
      assert_equal "60", response.headers["Retry-After"]
      assert_equal 0, SignInCode.count
    end

    test "when the cache store #{label}, OTP verify answers 503 and consumes nothing (fail closed)" do
      Rails.cache = store.call
      post "/api/auth/otp/verify", params: { email: "someone@example.com", code: "123456" }, env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :service_unavailable
      assert_equal "RATE_LIMIT_UNAVAILABLE", response.parsed_body["code"]
    end

    test "when the cache store #{label}, forgot-password and reset-password answer 503 (fail closed)" do
      Rails.cache = store.call
      post "/api/auth/forgot-password", params: { email: "someone@example.com" }, env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :service_unavailable
      post "/api/auth/reset-password", params: { token: "x", password: "StrongPass123!" }, env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :service_unavailable
      get "/api/auth/reset-password/check", params: { token: "x" }, env: { "REMOTE_ADDR" => IP }
      assert_response :service_unavailable
    end

    test "when the cache store #{label}, search, events and sign-up still work (fail open)" do
      Rails.cache = store.call
      get "/api/search", params: { q: "drums" }, env: { "REMOTE_ADDR" => IP }
      assert_response :success
      post "/api/events", params: { name: "page_view" }, env: { "REMOTE_ADDR" => IP }, as: :json
      assert_not_equal 503, response.status
      post "/api/auth/register", params: { name: "New", email: "new@example.com", password: "StrongPass123!", role: "jobseeker", consent: true }, env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :created
      # Login's failure budget is open too: a wrong password is still just 401.
      post "/api/auth/login", params: { email: "new@example.com", password: "wrong" }, env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :unauthorized
    end
  end

  test "the test suite's NullStore counts nothing and is not an outage" do
    Rails.cache = ActiveSupport::Cache::NullStore.new
    with_email_delivery do
      post "/api/auth/otp/request", params: { email: "someone@example.com" }, env: { "REMOTE_ADDR" => IP }, as: :json
    end
    assert_response :success
  end

  private

  def with_email_delivery(&)
    with_env("EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send", "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil, &)
  end
end
