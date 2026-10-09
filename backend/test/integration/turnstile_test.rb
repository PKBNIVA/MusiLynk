require "test_helper"

# Cloudflare Turnstile on sign-up and OTP request (Turnstile, AuthController#turnstile_passed?).
# The verifier is stubbed: no test talks to Cloudflare.
class TurnstileTest < ActionDispatch::IntegrationTest
  IP = "203.0.113.5".freeze
  SIGN_UP = { name: "New Person", email: "new@example.com", password: "StrongPass123!", role: "jobseeker", consent: true }.freeze
  EMAIL_ENV = { "EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send", "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil }.freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  test "without TURNSTILE_SECRET_KEY the check is off: sign-up and OTP request need no token" do
    with_env(EMAIL_ENV.merge("TURNSTILE_SECRET_KEY" => nil)) do
      assert_not Turnstile.enabled?
      assert Turnstile.verify(nil).skipped?
      post "/api/auth/register", params: SIGN_UP, env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :created
      post "/api/auth/otp/request", params: { email: "other@example.com" }, env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :success
    end
  end

  test "the config kill switch turns the check off even with the secret set" do
    with_env("TURNSTILE_SECRET_KEY" => "secret") do
      RateLimits.stub(:turnstile, RateLimits.turnstile.merge(enabled: false)) do
        assert_not Turnstile.enabled?
        post "/api/auth/register", params: SIGN_UP, env: { "REMOTE_ADDR" => IP }, as: :json
        assert_response :created
      end
    end
  end

  test "with the secret set, a missing or failed token is a 403 on sign-up and OTP request, and nothing is created" do
    with_verifier(->(token, **) { token == "good" ? Turnstile::Result.new(:ok, []) : Turnstile::Result.new(:failed, ["invalid-input-response"]) }) do
      post "/api/auth/register", params: SIGN_UP, env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :forbidden
      assert_equal "TURNSTILE_FAILED", response.parsed_body["code"]
      post "/api/auth/register", params: SIGN_UP.merge(turnstileToken: "bad"), env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :forbidden
      assert_equal 0, User.count

      with_env(EMAIL_ENV) do
        post "/api/auth/otp/request", params: { email: "other@example.com", turnstileToken: "bad" }, env: { "REMOTE_ADDR" => IP }, as: :json
      end
      assert_response :forbidden
      assert_equal "TURNSTILE_FAILED", response.parsed_body["code"]
      assert_equal 0, SignInCode.count
      # Failed challenges feed the spike counter under their own bucket.
      assert_equal 3, Rails.cache.read(UserRateLimit.spike_counter_key("turnstile-register")).to_i + Rails.cache.read(UserRateLimit.spike_counter_key("turnstile-otp-request")).to_i
    end
  end

  test "with the secret set, a verified token lets sign-up and OTP request through" do
    seen = []
    with_verifier(->(token, remote_ip: nil) { seen << [token, remote_ip]; Turnstile::Result.new(:ok, []) }) do
      post "/api/auth/register", params: SIGN_UP.merge(turnstileToken: "good"), env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :created
      with_env(EMAIL_ENV) do
        post "/api/auth/otp/request", params: { email: "other@example.com", turnstileToken: "good2" }, env: { "REMOTE_ADDR" => IP }, as: :json
      end
      assert_response :success
    end
    assert_equal [["good", IP], ["good2", IP]], seen
  end

  test "a verifier outage answers 503 TURNSTILE_UNAVAILABLE rather than letting the request through" do
    with_verifier(->(*, **) { Turnstile::Result.new(:unavailable, ["verifier-error"]) }) do
      post "/api/auth/register", params: SIGN_UP.merge(turnstileToken: "any"), env: { "REMOTE_ADDR" => IP }, as: :json
      assert_response :service_unavailable
      assert_equal "TURNSTILE_UNAVAILABLE", response.parsed_body["code"]
      assert_equal 0, User.count
    end
  end

  test "the verifier posts the secret and token to Cloudflare and reads success and error codes" do
    calls = []
    stubs = Faraday::Adapter::Test::Stubs.new do |stub|
      stub.post("/turnstile/v0/siteverify") do |env|
        calls << Rack::Utils.parse_nested_query(env.body)
        body = calls.size == 1 ? { success: true } : { success: false, "error-codes" => ["timeout-or-duplicate"] }
        [200, { "Content-Type" => "application/json" }, body.to_json]
      end
    end
    connection = Faraday.new { |f| f.request :url_encoded; f.response :json, content_type: /\bjson$/; f.adapter :test, stubs }
    with_env("TURNSTILE_SECRET_KEY" => "the-secret") do
      Turnstile.stub(:connection, connection) do
        assert Turnstile.verify("tok", remote_ip: IP).ok?
        failed = Turnstile.verify("tok")
        assert_equal :failed, failed.status
        assert_equal ["timeout-or-duplicate"], failed.codes
      end
      assert_equal({ "secret" => "the-secret", "response" => "tok", "remoteip" => IP }, calls.first)
      assert_equal :failed, Turnstile.verify("").status
      assert_equal 2, calls.size
    end
  end

  test "a network error from Cloudflare follows the configured fail mode" do
    stubs = Faraday::Adapter::Test::Stubs.new { |stub| stub.post("/turnstile/v0/siteverify") { raise Faraday::TimeoutError } }
    connection = Faraday.new { |f| f.adapter :test, stubs }
    with_env("TURNSTILE_SECRET_KEY" => "the-secret") do
      Turnstile.stub(:connection, connection) do
        assert Turnstile.verify("tok").unavailable?
        RateLimits.stub(:turnstile, RateLimits.turnstile.merge(on_verifier_error: "open")) do
          assert Turnstile.verify("tok").ok?
        end
      end
    end
  end

  private

  def with_verifier(verifier, &)
    with_env("TURNSTILE_SECRET_KEY" => "secret") do
      Turnstile.stub(:verify, verifier, &)
    end
  end
end
