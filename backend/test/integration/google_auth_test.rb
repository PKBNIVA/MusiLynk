require "test_helper"
require "openssl"

class GoogleAuthTest < ActionDispatch::IntegrationTest
  ENV_KEYS = { "GOOGLE_OAUTH_CLIENT_ID" => "client-123", "GOOGLE_OAUTH_CLIENT_SECRET" => "secret-abc",
    "API_URL" => "https://api.example.invalid", "FRONTEND_URL" => "https://app.example.invalid" }.freeze
  PASSWORD = "StrongPass123!".freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @key = OpenSSL::PKey::RSA.new(2048)
    @jwk = JWT::JWK.new(@key)
  end

  teardown { Rails.cache = @original_cache }

  test "start is disabled (404) without Google credentials configured" do
    with_env("GOOGLE_OAUTH_CLIENT_ID" => nil, "GOOGLE_OAUTH_CLIENT_SECRET" => nil) do
      get "/auth/google/start?intent=signin&role=jobseeker"
      assert_response :not_found
      assert_equal({ "error" => "disabled" }, response.parsed_body)
    end
  end

  test "start redirects to Google with a signed state and PKCE challenge" do
    with_env(ENV_KEYS) do
      get "/auth/google/start?intent=signin&role=jobseeker&return_to=/jobseeker/profile"
      assert_response :redirect
      assert_includes response.location, "accounts.google.com"
      assert_includes response.location, "code_challenge_method=S256"
    end
  end

  test "callback signs in a brand-new user, mints a one-time exchange code (never a session token) and redirects with auth=google" do
    stub_google_flow(email: "newmusician@example.com", email_verified: true) do |code, verifier|
      with_env(ENV_KEYS) do
        state = start_state(intent: "signin", role: "jobseeker", consent: true)
        get "/auth/google/callback?code=#{code}&state=#{state}"
      end
    end
    assert_response :redirect
    assert_includes response.location, "auth=google"
    assert_includes response.location, "code="
    # The Location header never carries a session token, only the opaque exchange code:
    # a 48-byte urlsafe-base64 session token and a 32-byte one are different lengths, but
    # what matters is there is no `token=` param at all on this redirect.
    assert_no_match(/[?&]token=/, response.location)

    user = User.find_by(email: "newmusician@example.com")
    assert user
    assert user.email_verified?
    assert_nil user.password_set_at
    assert AuthConnection.exists?(owner: user, provider: "google")
    assert AuditLog.exists?(actor: user, action: "auth.register")
    assert_equal 0, user.sessions.count, "no session exists until the code is exchanged"

    exchange_code = URI.decode_www_form(URI.parse(response.location).query).to_h["code"]
    post "/api/auth/exchange", params: { code: exchange_code }, as: :json
    assert_response :success
    assert_equal user.id, response.parsed_body.dig("user", "id")
    assert response.parsed_body["accessToken"].present?
    assert_equal 1, user.sessions.count

    # Single-use: the same code cannot be exchanged again.
    post "/api/auth/exchange", params: { code: exchange_code }, as: :json
    assert_response :unauthorized
    assert_equal "EXCHANGE_INVALID", response.parsed_body["code"]
  end

  test "an exchange code expires after 60 seconds" do
    user = User.create!(name: "Expiring", email: "expiring@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    code = AuthExchangeCode.issue!(user)
    travel 61.seconds do
      post "/api/auth/exchange", params: { code: }, as: :json
    end
    assert_response :unauthorized
    assert_equal "EXCHANGE_INVALID", response.parsed_body["code"]
  end

  test "exchange refuses a code that was never issued" do
    post "/api/auth/exchange", params: { code: "not-a-real-code" }, as: :json
    assert_response :unauthorized
  end

  test "callback with no role for a brand-new user sends the frontend to choose a role" do
    stub_google_flow(email: "norole@example.com", email_verified: true) do |code, verifier|
      with_env(ENV_KEYS) do
        state = start_state(intent: "signin", role: nil)
        get "/auth/google/callback?code=#{code}&state=#{state}"
      end
    end
    assert_response :redirect
    assert_includes response.location, "/auth/choose?next=google"
    assert_nil User.find_by(email: "norole@example.com")
  end

  test "callback signs in an existing user with a matching connection" do
    user = User.create!(name: "Returning", email: "returning@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    AuthConnection.create!(owner: user, provider: "google", provider_uid: "sub-existing", email: user.email, email_verified: true)

    stub_google_flow(email: "returning@example.com", email_verified: true, sub: "sub-existing") do |code|
      with_env(ENV_KEYS) do
        state = start_state(intent: "signin", role: "jobseeker")
        get "/auth/google/callback?code=#{code}&state=#{state}"
      end
    end
    assert_response :redirect
    assert_includes response.location, "auth=google"
  end

  test "callback with an unverified Google email redirects with auth_error=email_unverified" do
    stub_google_flow(email: "unverified@example.com", email_verified: false) do |code|
      with_env(ENV_KEYS) do
        state = start_state(intent: "signin", role: "jobseeker")
        get "/auth/google/callback?code=#{code}&state=#{state}"
      end
    end
    assert_response :redirect
    assert_includes response.location, "auth_error=email_unverified"
  end

  test "callback with a bad/expired state redirects with auth_error=state_mismatch" do
    with_env(ENV_KEYS) do
      get "/auth/google/callback?code=whatever&state=not-a-real-state"
    end
    assert_response :redirect
    assert_includes response.location, "auth_error=state_mismatch"
  end

  test "callback when Google reports an error redirects with auth_error=provider_error" do
    with_env(ENV_KEYS) do
      state = start_state(intent: "signin", role: "jobseeker")
      get "/auth/google/callback?error=access_denied&state=#{state}"
    end
    assert_response :redirect
    assert_includes response.location, "auth_error=provider_error"
  end

  test "connect intent links Google to the signed-in user, and reconnecting elsewhere is refused" do
    owner = User.create!(name: "Owner", email: "owner@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    token = session_for(owner)

    stub_google_flow(email: "owner-google@example.com", email_verified: true, sub: "sub-connect") do |code|
      with_env(ENV_KEYS) do
        get "/auth/google/start?intent=connect&token=#{token}"
        state = URI.decode_www_form(URI.parse(response.location).query).to_h["state"]
        get "/auth/google/callback?code=#{code}&state=#{state}"
      end
    end
    assert_response :redirect
    assert_includes response.location, "auth=google"
    assert AuthConnection.exists?(owner: owner, provider: "google", provider_uid: "sub-connect")

    other = User.create!(name: "Other", email: "other@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    other_token = session_for(other)
    stub_google_flow(email: "owner-google@example.com", email_verified: true, sub: "sub-connect") do |code|
      with_env(ENV_KEYS) do
        get "/auth/google/start?intent=connect&token=#{other_token}"
        state = URI.decode_www_form(URI.parse(response.location).query).to_h["state"]
        get "/auth/google/callback?code=#{code}&state=#{state}"
      end
    end
    assert_includes response.location, "auth_error=connected_elsewhere"
  end

  private

  def start_state(intent:, role:, return_to: nil, consent: false, owner_user_id: nil)
    Rails.application.message_verifier("google-oauth-state").generate(
      { "csrf" => "x", "verifier" => "verifier-value", "intent" => intent, "role" => role,
        "return_to" => return_to, "consent" => consent, "owner_user_id" => owner_user_id },
      purpose: :google_oauth_state, expires_in: 10.minutes
    )
  end

  # Stubs the Google token endpoint and JWKS for one callback and yields the fake
  # authorization `code` (the controller never inspects it beyond passing it through).
  def stub_google_flow(email:, email_verified:, sub: "sub-#{email}")
    jwks_body = { keys: [@jwk.export(include_private: false).merge(alg: "RS256", use: "sig")] }.to_json
    Rails.cache.write(GoogleOauth::JWKS_CACHE_KEY, JSON.parse(jwks_body)["keys"], expires_in: 1.hour)
    id_token = JWT.encode({ sub:, email:, email_verified:, name: "Test User", iss: "https://accounts.google.com",
      aud: "client-123", exp: 1.hour.from_now.to_i }, @key, "RS256", { kid: @jwk.kid })

    original_exchange = GoogleOauth.method(:exchange_code)
    GoogleOauth.define_singleton_method(:exchange_code) do |code:, code_verifier:, client: nil|
      { id_token:, access_token: "google-access-token", refresh_token: nil, expires_in: 3600 }
    end
    yield "fake-code"
  ensure
    GoogleOauth.define_singleton_method(:exchange_code, original_exchange)
  end

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    Session.start!(user, token_digest: Digest::SHA256.hexdigest(raw), user_agent: nil)
    raw
  end

  def with_env(values)
    old = values.to_h { |key, _| [key.to_s, ENV[key.to_s]] }
    values.each { |key, value| value.nil? ? ENV.delete(key.to_s) : ENV[key.to_s] = value }
    yield
  ensure
    old&.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
