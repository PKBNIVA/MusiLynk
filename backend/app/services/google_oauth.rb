require "net/http"
require "uri"
require "json"
require "jwt"

# Google OAuth 2.0 / OpenID Connect for "Continue with Google" (GoogleAuthController).
# Talks to Google directly with Net::HTTP (mirroring WhatsappAlerts' style) rather than a
# gem, since this app has no session middleware for omniauth to hang a callback phase on.
#
# Off (GoogleAuthController#start answers 404 disabled, and #google is false in /auth/methods)
# unless both GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are set.
class GoogleOauth
  AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth".freeze
  TOKEN_URL = "https://oauth2.googleapis.com/token".freeze
  JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs".freeze
  REVOKE_URL = "https://oauth2.googleapis.com/revoke".freeze
  ISSUERS = %w[accounts.google.com https://accounts.google.com].freeze
  JWKS_CACHE_KEY = "google_oauth:jwks".freeze
  JWKS_CACHE_TTL = 1.hour
  SCOPE = "openid email profile".freeze
  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 5

  class VerificationError < StandardError; end
  class TokenExchangeError < StandardError; end

  def self.enabled? = ENV["GOOGLE_OAUTH_CLIENT_ID"].present? && ENV["GOOGLE_OAUTH_CLIENT_SECRET"].present?

  def self.redirect_uri
    "#{ENV.fetch('API_URL', nil) || api_origin}/auth/google/callback"
  end

  # Falls back to deriving the API origin from FRONTEND_URL's Railway sibling only as a last
  # resort; API_URL should be set in every environment that enables Google sign-in.
  def self.api_origin
    ENV["API_URL"].presence || "http://localhost:3000"
  end

  def self.authorize_url(state:, code_challenge:)
    params = {
      client_id: ENV.fetch("GOOGLE_OAUTH_CLIENT_ID"),
      redirect_uri: redirect_uri,
      response_type: "code",
      scope: SCOPE,
      state:,
      code_challenge:,
      code_challenge_method: "S256",
      access_type: "online",
      prompt: "select_account"
    }
    "#{AUTHORIZE_URL}?#{URI.encode_www_form(params)}"
  end

  # -> { id_token:, access_token:, refresh_token:, expires_in: } or raises TokenExchangeError.
  def self.exchange_code(code:, code_verifier:, client: nil)
    body = URI.encode_www_form(
      code:, client_id: ENV.fetch("GOOGLE_OAUTH_CLIENT_ID"), client_secret: ENV.fetch("GOOGLE_OAUTH_CLIENT_SECRET"),
      redirect_uri:, grant_type: "authorization_code", code_verifier:
    )
    status, raw = post_form(TOKEN_URL, body, client:)
    raise TokenExchangeError, "Google token exchange failed (#{status})" unless status.between?(200, 299)
    JSON.parse(raw).symbolize_keys
  rescue JSON::ParserError
    raise TokenExchangeError, "Google token exchange returned an invalid response"
  end

  # Verifies signature (via Google's cached JWKS), issuer, audience and expiry.
  # -> decoded claims hash, or raises VerificationError.
  def self.verify_id_token(id_token, client: nil)
    jwks = fetch_jwks(client:)
    decoded = JWT.decode(id_token, nil, true, {
      algorithms: ["RS256"], jwks: { keys: jwks }, verify_iss: true, iss: ISSUERS,
      verify_aud: true, aud: ENV.fetch("GOOGLE_OAUTH_CLIENT_ID"), verify_expiration: true
    })
    decoded.first
  rescue JWT::DecodeError, JWT::VerificationError => e
    raise VerificationError, "Google ID token verification failed: #{e.message}"
  end

  def self.fetch_jwks(client: nil)
    cached = Rails.cache.read(JWKS_CACHE_KEY)
    return cached if cached

    status, raw = get(JWKS_URL, client:)
    raise VerificationError, "Could not fetch Google's signing keys (#{status})" unless status.between?(200, 299)
    keys = JSON.parse(raw)["keys"]
    Rails.cache.write(JWKS_CACHE_KEY, keys, expires_in: JWKS_CACHE_TTL)
    keys
  rescue JSON::ParserError
    raise VerificationError, "Could not parse Google's signing keys"
  end

  # Best-effort; never raises (see AuthConnectionsController#destroy).
  def self.revoke(token, client: nil)
    return unless token.present?
    post_form(REVOKE_URL, URI.encode_www_form(token:), client:)
  rescue StandardError => e
    Rails.logger.warn({ event: "google_oauth_revoke_failed", error: e.class.name }.to_json)
  end

  def self.post_form(url, body, client: nil)
    return client.post(url, body) if client
    uri = URI.parse(url)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = OPEN_TIMEOUT
    http.read_timeout = READ_TIMEOUT
    request = Net::HTTP::Post.new(uri.request_uri, { "Content-Type" => "application/x-www-form-urlencoded" })
    request.body = body
    response = http.request(request)
    [response.code.to_i, response.body]
  end

  def self.get(url, client: nil)
    return client.get(url) if client
    uri = URI.parse(url)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = OPEN_TIMEOUT
    http.read_timeout = READ_TIMEOUT
    response = http.request(Net::HTTP::Get.new(uri.request_uri))
    [response.code.to_i, response.body]
  end
end
