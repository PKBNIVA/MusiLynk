require "test_helper"
require "minitest/mock"
require "openssl"

# Re-review of PR 151 round 1: probes of the new behaviour.
class SecurityReReviewTest < ActionDispatch::IntegrationTest
  PASSWORD = "StrongPass123!".freeze

  setup do
    @seq = 0
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @alice = create_user("Alice Rev", "jobseeker", location: "Mumbai", roles: ["Drummer"])
  end

  teardown { Rails.cache = @original_cache }

  def register_unverified(email)
    post "/api/auth/register", params: { name: "Una Verified", email:, password: PASSWORD, role: "jobseeker" }, as: :json
    assert_response :created
    User.find_by!(email:)
  end

  test "RR-1 a password reset proves the mailbox, so the new password works afterwards" do
    email = "reset-unverified@example.com"
    user = register_unverified(email)
    raw = SecureRandom.urlsafe_base64(32)
    EmailToken.create!(user:, purpose: "reset_password", token_digest: Digest::SHA256.hexdigest(raw), expires_at: 2.hours.from_now)
    post "/api/auth/reset-password", params: { token: raw, password: "BrandNewPass456!" }, as: :json
    assert_response :success
    post "/api/auth/login", params: { email:, password: "BrandNewPass456!" }, as: :json
    assert_response :success, "after proving the mailbox with a reset link the person is still told to confirm their email (#{response.body})"
  end

  test "RR-2 resend-verification answers the same for unknown and unverified addresses even after repeated asks" do
    register_unverified("exists-unverified@example.com")
    statuses = {}
    %w[exists-unverified@example.com nobody-here@example.com].each do |email|
      statuses[email] = 5.times.map do
        post "/api/auth/resend-verification", params: { email: }, as: :json
        response.status
      end
    end
    assert_equal statuses["nobody-here@example.com"], statuses["exists-unverified@example.com"], "status sequence reveals which address has an unverified account: #{statuses.inspect}"
  end

  test "RR-3 an unverified account whose address bounced is rescued by an admin confirming the email" do
    email = "bounced-unverified@example.com"
    user = register_unverified(email)
    EmailSuppression.create!(email:, reason: "hard_bounce", scope: "all", last_event: "hard_bounce", last_event_at: Time.current)
    post "/api/auth/login", params: { email:, password: PASSWORD }, as: :json
    assert_response :forbidden
    assert_equal "EMAIL_VERIFICATION_REQUIRED", response.parsed_body["code"]

    admin = create_user("Admin Rescue", "admin")
    post "/api/admin/users/#{user.id}/confirm-email", headers: auth(@alice), as: :json
    assert_response :forbidden, "a non-admin confirmed someone's email"
    assert_not user.reload.email_verified?
    with_env("ADMIN_ORIGIN" => "https://admin.example.invalid") do
      post "/api/admin/users/#{user.id}/confirm-email", headers: auth(admin), as: :json
      assert_response :forbidden, "the admin API answered the wrong origin"
    end
    post "/api/admin/users/#{user.id}/confirm-email", headers: auth(admin), as: :json
    assert_response :success
    assert user.reload.email_verified?
    assert AuditLog.exists?(actor: admin, action: "admin.user.confirm_email", entity_id: user.id)
    post "/api/auth/login", params: { email:, password: PASSWORD }, as: :json
    assert_response :success
  end

  test "RR-3 the copy for unavailable codes and suppressed addresses no longer tells everyone to use a password" do
    [AuthController::OTP_UNAVAILABLE_MESSAGE, AuthController::EMAIL_SUPPRESSED_MESSAGE].each do |message|
      assert_no_match(/sign in with your password|use your password instead/i, message)
      assert_match(/support/i, message)
    end
  end

  test "RR-4 webhook: genuine retry is a no-op, a different body with a reused id is processed once" do
    with_env("RAZORPAY_WEBHOOK_SECRET" => "whsec_rr") do
      send_hook = lambda do |body, id|
        raw = body.to_json
        post "/api/billing/webhook/razorpay", params: raw, headers: { "Content-Type" => "application/json", "X-Razorpay-Event-Id" => id, "X-Razorpay-Signature" => OpenSSL::HMAC.hexdigest("SHA256", "whsec_rr", raw) }
      end
      a = { event: "payment.noop", payload: { n: 1 } }
      b = { event: "payment.noop", payload: { n: 2 } }
      send_hook.call(a, "e1"); assert_nil response.parsed_body["duplicate"]
      send_hook.call(a, "e1"); assert_equal true, response.parsed_body["duplicate"]
      send_hook.call(b, "e1"); assert_nil response.parsed_body["duplicate"]
      send_hook.call(b, "e1"); assert_equal true, response.parsed_body["duplicate"]
      send_hook.call(a, "e1"); assert_equal true, response.parsed_body["duplicate"]
      assert_equal 2, BillingEvent.where(provider: "razorpay").count
    end
  end

  test "RR-5 jobs of an erased employer are gone from lists and shares, not only the detail page" do
    hirer = create_user("Hirer Rev", "employer", company_name: "Rev Studio")
    job = Job.create!(employer: hirer, title: "Drummer needed", company: "Rev Studio", location: "Mumbai", kind: "Contract", genre: "Pop",
      description: "A properly documented professional opportunity with clear responsibilities, written terms and collaborative production support.", status: "published")
    delete "/api/account", params: { confirmEmail: hirer.email }, headers: auth(hirer), as: :json
    assert_response :success
    get "/api/jobs/#{job.id}"
    assert_response :not_found
    get "/api/jobs", params: { q: "Drummer needed" }
    refute_includes response.body, job.id, "erased employer's job still in the public listing"
  end

  test "RR-6 reset email window is 10 minutes and a second request after it sends a new link" do
    user = @alice
    post "/api/auth/forgot-password", params: { email: user.email }, as: :json
    first = EmailToken.where(user:, purpose: "reset_password").count
    post "/api/auth/forgot-password", params: { email: user.email }, as: :json
    assert_equal first, EmailToken.where(user:, purpose: "reset_password").count
    travel 11.minutes do
      post "/api/auth/forgot-password", params: { email: user.email }, as: :json
      assert_equal first + 1, EmailToken.where(user:, purpose: "reset_password").count
    end
  end

  test "RR-7 resend-verification sends at most 3 links an hour to one address and 10 requests an hour per IP" do
    user = register_unverified("spam-target@example.com")
    before = EmailToken.where(user:, purpose: "verify_email").count
    8.times { post "/api/auth/resend-verification", params: { email: user.email }, as: :json }
    assert_operator EmailToken.where(user:, purpose: "verify_email").count - before, :<=, 3
  end

  test "RR-8 victim resetting the password of an attacker-registered account also ends the attacker's linked Google identity" do
    email = "pre-hijack-reset@example.com"
    user = register_unverified(email)
    AuthConnection.create!(owner: user, provider: "google", provider_uid: "sub-attacker-own-google@example.com", email: "attacker-own-google@example.com")
    raw = SecureRandom.urlsafe_base64(32)
    EmailToken.create!(user:, purpose: "reset_password", token_digest: Digest::SHA256.hexdigest(raw), expires_at: 2.hours.from_now)
    post "/api/auth/reset-password", params: { token: raw, password: "VictimNewPass456!" }, as: :json
    assert_response :success
    assert_empty user.reload.auth_connections, "the pre-linked Google identity survived the reset"
    assert user.email_verified?
    post "/api/auth/login", params: { email:, password: "VictimNewPass456!" }, as: :json
    assert_response :success
    google_callback(email: "attacker-own-google@example.com") do
      if response.location.include?("code=")
        post "/api/auth/exchange", params: { code: Rack::Utils.parse_query(URI.parse(response.location).query)["code"] }, as: :json
        assert_not_equal user.id, response.parsed_body.dig("user", "id"), "attacker's pre-linked Google identity still signs in to the victim's account"
      end
    end
  end

  private

  def create_job(owner, status)
    Job.create!(employer: owner, title: "Gig #{SecureRandom.hex(2)}", company: "Rev Co", location: "Mumbai", kind: "Project-based", genre: "Jazz",
      description: "A long enough description for the listing to be valid and published without complaint. " * 2, status:, published_at: (Time.current if status == "published"))
  end

  def auth(user) = { "Authorization" => "Bearer #{session_token(user)}" }

  def session_token(user)
    @tokens ||= {}
    @tokens[user.id] ||= SecureRandom.urlsafe_base64(48).tap do |raw|
      Session.start!(user, token_digest: Digest::SHA256.hexdigest(raw), user_agent: nil)
    end
  end

  def create_user(name, role, **profile)
    @seq += 1
    user = User.create!(name:, email: "audit-#{@seq}-#{SecureRandom.hex(3)}@example.com", password: PASSWORD, role:, status: "active", profile_complete: true, email_verified: true)
    user.create_profile!(profile) unless role == "admin"
    user
  end

  GOOGLE_ENV = { "GOOGLE_OAUTH_CLIENT_ID" => "client-123", "GOOGLE_OAUTH_CLIENT_SECRET" => "secret-abc",
    "API_URL" => "https://api.example.invalid", "FRONTEND_URL" => "https://app.example.invalid" }.freeze

  # Runs one Google callback for a verified Google identity with `email`, yielding afterwards for the assertions.
  def google_callback(email:)
    key = OpenSSL::PKey::RSA.new(2048)
    jwk = JWT::JWK.new(key)
    Rails.cache.write(GoogleOauth::JWKS_CACHE_KEY, [jwk.export(include_private: false).merge(alg: "RS256", use: "sig")], expires_in: 1.hour)
    id_token = JWT.encode({ sub: "sub-#{email}", email:, email_verified: true, name: "Google Person", iss: "https://accounts.google.com",
      aud: "client-123", exp: 1.hour.from_now.to_i }, key, "RS256", { kid: jwk.kid })
    original = GoogleOauth.method(:exchange_code)
    GoogleOauth.define_singleton_method(:exchange_code) { |code:, code_verifier:, client: nil| { id_token:, access_token: "t", refresh_token: nil, expires_in: 3600 } }
    state = Rails.application.message_verifier("google-oauth-state").generate(
      { "csrf" => "x", "verifier" => "v", "intent" => "signin", "role" => "jobseeker", "return_to" => nil, "consent" => true, "ticket" => nil },
      purpose: :google_oauth_state, expires_in: 10.minutes
    )
    with_env(GOOGLE_ENV) do
      get "/auth/google/callback?code=fake-code&state=#{state}", headers: { "Cookie" => oauth_cookie("x") }
      yield
    end
  ensure
    GoogleOauth.define_singleton_method(:exchange_code, original) if original
  end

  def oauth_cookie(nonce)
    value = Rails.application.message_verifier("google-oauth-state-cookie").generate(nonce, purpose: :google_oauth_state_cookie, expires_in: 10.minutes)
    "#{GoogleAuthController::STATE_COOKIE}=#{CGI.escape(value)}"
  end

  def with_env(values)
    old = values.to_h { |key, _| [key.to_s, ENV[key.to_s]] }
    values.each { |key, value| value.nil? ? ENV.delete(key.to_s) : ENV[key.to_s] = value }
    yield
  ensure
    old&.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
