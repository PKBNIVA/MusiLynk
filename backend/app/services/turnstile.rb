# Cloudflare Turnstile verification for sign-up and OTP request (docs/ops/turnstile.md).
#
# Off until TURNSTILE_SECRET_KEY is set on the API service *and* `turnstile.enabled` is true in
# config/rate_limits.yml; the frontend widget is likewise off until VITE_TURNSTILE_SITE_KEY is set.
# When off, `verify` answers :skipped and controllers let the request through unchanged, so a
# deploy without the key, or a kill switch in the config, is a clean no-op.
#
# Fail mode when Cloudflare's siteverify endpoint itself errors or times out is configured
# (`turnstile.on_verifier_error`): "closed" answers :unavailable (controller renders 503), "open"
# answers :ok and logs. The secret is never logged; nothing about the visitor but their IP is sent.
module Turnstile
  Result = Struct.new(:status, :codes) do
    def ok? = status == :ok || status == :skipped
    def skipped? = status == :skipped
    def unavailable? = status == :unavailable
  end

  module_function

  def secret = ENV["TURNSTILE_SECRET_KEY"].presence

  def enabled? = secret.present? && RateLimits.turnstile.fetch(:enabled) == true

  def settings = RateLimits.turnstile

  # `token` is the cf-turnstile-response the widget produced; `remote_ip` is optional but makes
  # Cloudflare's check stricter. Returns a Result: :ok, :skipped (disabled), :failed, :unavailable.
  def verify(token, remote_ip: nil)
    return Result.new(:skipped, []) unless enabled?
    return Result.new(:failed, ["missing-input-response"]) if token.blank? || token.to_s.length > 2048

    body = { secret:, response: token.to_s }
    body[:remoteip] = remote_ip if remote_ip.present?
    response = connection.post(settings.fetch(:verify_url), body)
    data = response.body.is_a?(Hash) ? response.body : JSON.parse(response.body.to_s)
    return Result.new(:ok, []) if data["success"] == true

    codes = Array(data["error-codes"]).map(&:to_s)
    Rails.logger.info({ event: "turnstile_failed", codes: }.to_json)
    Result.new(:failed, codes)
  rescue Faraday::Error, JSON::ParserError, SocketError, Timeout::Error => error
    Rails.logger.error({ event: "turnstile_verifier_error", error: error.class.name }.to_json)
    ErrorReporter.capture(error, tags: { source: "turnstile" }, fingerprint: ["turnstile_verifier_error"])
    settings.fetch(:on_verifier_error).to_s == "open" ? Result.new(:ok, ["verifier-error"]) : Result.new(:unavailable, ["verifier-error"])
  end

  def connection
    timeout = settings.fetch(:timeout_seconds).to_i
    Faraday.new(request: { timeout:, open_timeout: timeout }) do |f|
      f.request :url_encoded
      f.response :json, content_type: /\bjson$/
    end
  end
end
