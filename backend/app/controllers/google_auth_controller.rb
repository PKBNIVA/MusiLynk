# "Continue with Google": GET /auth/google/start and GET /auth/google/callback. Full-page
# browser redirects, not JSON, so these live outside the /api scope (see config/routes.rb) —
# the Google OAuth consent screen and Google's callback navigate the browser directly.
#
# There is no cookie/session middleware in this API-only app (see ApplicationController):
# the state Google echoes back is a signed, short-lived token (Rails' message_verifier) that
# carries everything the callback needs (a CSRF nonce, the PKCE verifier, intent, role,
# return_to and — for intent=connect — a single-use ticket identifying who is linking, see
# GoogleConnectTicket). Nothing is stored server-side beyond that ticket, so "verifying
# state" is exactly verifying that signature and its expiry.
#
# A full-page redirect cannot set an Authorization header, so neither direction of this
# flow ever puts a bearer session token in a URL (it would leak via browser history, a
# Referer header or a hosting provider's request logs): #start reads a one-time
# GoogleConnectTicket instead of a token for intent=connect, and #callback hands the
# frontend a one-time AuthExchangeCode, which POST /api/auth/exchange trades for the real
# session token exactly like a normal login response — never the token itself.
class GoogleAuthController < ApplicationController
  STATE_PURPOSE = :google_oauth_state
  STATE_TTL = 10.minutes
  # Binds the OAuth state to the browser that started the flow (login CSRF): /start sets this
  # signed cookie holding the state's nonce, /callback only accepts a state whose nonce it carries.
  STATE_COOKIE = "verse_oauth_state".freeze
  STATE_COOKIE_PURPOSE = :google_oauth_state_cookie
  DEFAULT_RETURN_TO = { "jobseeker" => "/jobseeker", "employer" => "/employer" }.freeze
  JOIN_PATH = { "jobseeker" => "/join/musician", "employer" => "/join/hiring" }.freeze

  # GET /auth/google/start?intent=signin|connect&role=&return_to=&consent=1&ticket=
  # `ticket` (intent=connect only) comes from POST /api/auth/connect-ticket.
  def start
    return render json: { error: "disabled" }, status: :not_found unless GoogleOauth.enabled?

    intent = params[:intent] == "connect" ? "connect" : "signin"
    return render json: { error: "disabled" }, status: :not_found if intent == "connect" && !GoogleConnectTicket.valid?(params[:ticket])

    verifier = SecureRandom.urlsafe_base64(32)
    challenge = Digest::SHA256.base64digest(verifier).tr("+/", "-_").delete("=")
    nonce = SecureRandom.hex(16)
    state = state_verifier.generate({
      "csrf" => nonce, "verifier" => verifier, "intent" => intent,
      "role" => %w[jobseeker employer].include?(params[:role]) ? params[:role] : nil,
      "return_to" => safe_return_to(params[:return_to]),
      "consent" => ActiveModel::Type::Boolean.new.cast(params[:consent]) == true,
      "ticket" => intent == "connect" ? params[:ticket] : nil
    }, purpose: STATE_PURPOSE, expires_in: STATE_TTL)

    set_state_cookie(nonce)
    redirect_to GoogleOauth.authorize_url(state:, code_challenge: challenge), allow_other_host: true
  end

  # GET /auth/google/callback?code=&state=  (or ?error=... when the person cancels)
  def callback
    payload = read_state(params[:state])
    return redirect_with_error("state_mismatch") unless payload && state_cookie_matches?(payload)
    clear_state_cookie
    return redirect_with_error("provider_error", payload) if params[:error].present?

    begin
      tokens = GoogleOauth.exchange_code(code: params[:code], code_verifier: payload["verifier"])
      claims = GoogleOauth.verify_id_token(tokens[:id_token])
    rescue GoogleOauth::TokenExchangeError, GoogleOauth::VerificationError => e
      Rails.logger.warn({ event: "google_oauth_callback_failed", error: e.class.name }.to_json)
      return redirect_with_error("provider_error", payload)
    end

    owner_user = payload["intent"] == "connect" ? GoogleConnectTicket.redeem!(payload["ticket"]) : nil
    return redirect_with_error("disabled", payload) if payload["intent"] == "connect" && owner_user.nil?

    result = GoogleSignIn.call(claims:, intent: payload["intent"], role: payload["role"], owner_user:, consent: payload["consent"])
    return redirect_to_choose_role(payload) if result.error == "role_required"
    return redirect_with_error(result.error, payload) unless result.ok?
    return redirect_with_error("disabled", payload) unless result.user.active?

    notify_linked(result.user) if result.notify_linked
    audit_google_sign_in(result, payload)
    result.user.update!(last_login_at: Time.current)
    code = AuthExchangeCode.issue!(result.user)
    redirect_to success_url(result, payload, code), allow_other_host: true
  end

  private

  def state_verifier = Rails.application.message_verifier("google-oauth-state")
  def cookie_verifier = Rails.application.message_verifier("google-oauth-state-cookie")

  def set_state_cookie(nonce)
    value = cookie_verifier.generate(nonce, purpose: STATE_COOKIE_PURPOSE, expires_in: STATE_TTL)
    response.headers["Set-Cookie"] = "#{STATE_COOKIE}=#{CGI.escape(value)}; Path=/auth/google; Max-Age=#{STATE_TTL.to_i}; HttpOnly; Secure; SameSite=Lax"
  end

  def clear_state_cookie
    response.headers["Set-Cookie"] = "#{STATE_COOKIE}=; Path=/auth/google; Max-Age=0; HttpOnly; Secure; SameSite=Lax"
  end

  def state_cookie_matches?(payload)
    raw = request.cookies[STATE_COOKIE]
    nonce = raw.is_a?(String) && raw.length <= 1024 ? cookie_verifier.verified(raw, purpose: STATE_COOKIE_PURPOSE) : nil
    nonce.is_a?(String) && payload["csrf"].is_a?(String) && ActiveSupport::SecurityUtils.secure_compare(nonce, payload["csrf"])
  rescue StandardError
    false
  end

  def read_state(raw)
    return nil unless raw.is_a?(String) && raw.length <= 4096
    payload = state_verifier.verified(raw, purpose: STATE_PURPOSE)
    payload if payload.is_a?(Hash)
  rescue StandardError
    nil
  end

  def safe_return_to(value)
    value.is_a?(String) && value.start_with?("/") && !value.start_with?("//") ? value.first(500) : nil
  end

  def notify_linked(user)
    return unless EmailDelivery.configured?
    EmailDeliveryJob.enqueue(user:, template: "google_connected", link: "#{frontend_url}/account")
  rescue StandardError => e
    Rails.logger.error({ event: "email_enqueue_failed", template: "google_connected", error: e.class.name }.to_json)
    ErrorReporter.capture(e, tags: { source: "email_enqueue_failed", template: "google_connected" })
  end

  def audit_google_sign_in(result, payload)
    action = payload["intent"] == "connect" ? "auth.google_connected" : (result.created ? "auth.register" : "auth.login")
    AuditLog.create!(actor: result.user, action:, entity_type: "User", entity_id: result.user.id,
      metadata: { method: "google", ip: request.remote_ip })
  end

  def default_return_to(role, new_incomplete_user)
    return JOIN_PATH.fetch(role, "/join/musician") if new_incomplete_user
    DEFAULT_RETURN_TO.fetch(role, "/jobseeker")
  end

  def success_url(result, payload, code)
    return_to = payload["return_to"] || default_return_to(result.user.role, result.created && !result.user.profile_complete)
    "#{frontend_url}#{return_to}?auth=google&code=#{CGI.escape(code)}"
  end

  def redirect_to_choose_role(payload)
    return_to = CGI.escape(payload["return_to"] || "/")
    redirect_to "#{frontend_url}/auth/choose?next=google&return_to=#{return_to}", allow_other_host: true
  end

  def redirect_with_error(code, payload = nil)
    role = payload && payload["role"]
    base = payload && payload["return_to"] ? payload["return_to"] : "/auth/#{role || 'jobseeker'}"
    redirect_to "#{frontend_url}#{base}?auth_error=#{code}", allow_other_host: true
  end

  def frontend_url = FrontendUrl.base
end
