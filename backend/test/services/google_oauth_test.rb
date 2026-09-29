require "test_helper"
require "openssl"

class GoogleOauthTest < ActiveSupport::TestCase
  FakeClient = Struct.new(:token_response, :jwks_response, :calls) do
    def initialize(token_response: nil, jwks_response: nil)
      super(token_response, jwks_response, [])
    end

    def post(url, body)
      calls << [:post, url, body]
      token_response
    end

    def get(url)
      calls << [:get, url]
      jwks_response
    end
  end

  ENV_KEYS = { "GOOGLE_OAUTH_CLIENT_ID" => "client-123", "GOOGLE_OAUTH_CLIENT_SECRET" => "secret-abc", "API_URL" => "https://api.example.invalid" }.freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @key = OpenSSL::PKey::RSA.new(2048)
  end

  teardown { Rails.cache = @original_cache }

  test "disabled without both client id and secret" do
    with_env("GOOGLE_OAUTH_CLIENT_ID" => nil, "GOOGLE_OAUTH_CLIENT_SECRET" => nil) do
      assert_not GoogleOauth.enabled?
    end
    with_env("GOOGLE_OAUTH_CLIENT_ID" => "x", "GOOGLE_OAUTH_CLIENT_SECRET" => nil) do
      assert_not GoogleOauth.enabled?
    end
  end

  test "enabled with both configured" do
    with_env(ENV_KEYS) { assert GoogleOauth.enabled? }
  end

  test "authorize_url only ever requests openid email profile" do
    with_env(ENV_KEYS) do
      url = GoogleOauth.authorize_url(state: "s", code_challenge: "c")
      assert_includes url, "scope=openid+email+profile"
      assert_includes url, "code_challenge_method=S256"
      assert_includes url, CGI.escape(GoogleOauth.redirect_uri)
    end
  end

  test "exchange_code raises on a non-2xx response" do
    with_env(ENV_KEYS) do
      client = FakeClient.new(token_response: [400, "bad request"])
      assert_raises(GoogleOauth::TokenExchangeError) { GoogleOauth.exchange_code(code: "c", code_verifier: "v", client:) }
    end
  end

  test "exchange_code returns the parsed token response" do
    with_env(ENV_KEYS) do
      client = FakeClient.new(token_response: [200, { id_token: "abc", access_token: "tok", expires_in: 3600 }.to_json])
      tokens = GoogleOauth.exchange_code(code: "c", code_verifier: "v", client:)
      assert_equal "abc", tokens[:id_token]
    end
  end

  test "verify_id_token accepts a correctly signed, current token and rejects a bad audience" do
    with_env(ENV_KEYS) do
      jwk = JWT::JWK.new(@key)
      jwks_body = { keys: [jwk.export(include_private: false).merge(alg: "RS256", use: "sig")] }.to_json
      client = FakeClient.new(jwks_response: [200, jwks_body])

      good_token = JWT.encode({ sub: "u1", email: "a@example.com", email_verified: true, iss: "https://accounts.google.com",
        aud: "client-123", exp: 1.hour.from_now.to_i }, @key, "RS256", { kid: jwk.kid })
      claims = GoogleOauth.verify_id_token(good_token, client:)
      assert_equal "u1", claims["sub"]

      bad_aud_token = JWT.encode({ sub: "u1", iss: "https://accounts.google.com", aud: "someone-else",
        exp: 1.hour.from_now.to_i }, @key, "RS256", { kid: jwk.kid })
      assert_raises(GoogleOauth::VerificationError) { GoogleOauth.verify_id_token(bad_aud_token, client:) }
    end
  end

  test "verify_id_token rejects an expired token" do
    with_env(ENV_KEYS) do
      jwk = JWT::JWK.new(@key)
      jwks_body = { keys: [jwk.export(include_private: false).merge(alg: "RS256", use: "sig")] }.to_json
      client = FakeClient.new(jwks_response: [200, jwks_body])
      expired = JWT.encode({ sub: "u1", iss: "https://accounts.google.com", aud: "client-123",
        exp: 1.hour.ago.to_i }, @key, "RS256", { kid: jwk.kid })
      assert_raises(GoogleOauth::VerificationError) { GoogleOauth.verify_id_token(expired, client:) }
    end
  end

  test "jwks is cached across calls" do
    with_env(ENV_KEYS) do
      jwk = JWT::JWK.new(@key)
      jwks_body = { keys: [jwk.export(include_private: false).merge(alg: "RS256", use: "sig")] }.to_json
      client = FakeClient.new(jwks_response: [200, jwks_body])
      GoogleOauth.fetch_jwks(client:)
      GoogleOauth.fetch_jwks(client:)
      assert_equal 1, client.calls.count { |c| c.first == :get }
    end
  end

  def with_env(values)
    old = values.to_h { |key, _| [key.to_s, ENV[key.to_s]] }
    values.each { |key, value| value.nil? ? ENV.delete(key.to_s) : ENV[key.to_s] = value }
    yield
  ensure
    old&.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
