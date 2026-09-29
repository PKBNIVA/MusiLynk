# "Continue with Google": GET /auth/google/start and GET /auth/google/callback. Full-page
# browser redirects, not JSON, so these live outside the /api scope (see config/routes.rb) —
# the Google OAuth consent screen and Google's callback navigate the browser directly.
#
# There is no cookie/session middleware in this API-only app (see ApplicationController):
# the state Google echoes back is a signed, short-lived token (Rails' message_verifier) that
# carries everything the callback needs (a CSRF nonce, the PKCE verifier, intent, role,
# return_to and — for intent=connect — which signed-in user is linking). Nothing is stored
# server-side, so "verifying state" is exactly verifying that signature and its expiry.
#
# Since there is also no session cookie to carry the result of a full-page redirect, the
# callback hands the frontend the new session's bearer token as a query parameter on the
# final redirect (`&token=`), the same way an emailed sign-in link already carries a secret
# in its query string; the frontend stores it exactly like a normal login response.
class GoogleAuthController < ApplicationController
  STATE_PURPOSE = :google_oauth_state
  STATE_TTL = 10.minutes
  DEFAULT_RETURN_TO = { "jobseeker" => "/jobseeker", "employer" => "/employer" }.freeze
  JOIN_PATH = { "jobseeker" => "/join/musician", "employer" => "/join/hiring" }.freeze

  # GET /auth/google/start?intent=signin|connect&role=&return_to=&consent=1&token=
  def start
    return render json: { error: "disabled" }, status: :not_found unless GoogleOauth.enabled?

    intent = params[:intent] == "connect" ? "connect" : "signin"
    owner_user = intent == "connect" ? user_from_query_token : nil
    return render json: { error: "disabled" }, status: :not_found if intent == "connect" && owner_user.nil?

    verifier = SecureRandom.urlsafe_base64(32)
    challenge = Digest::SHA256.base64digest(verifier).tr("+/", "-_").delete("=")
    state = state_verifier.generate({
      "csrf" => SecureRandom.hex(16), "verifier" => verifier, "intent" => intent,
      "role" => %w[jobseeker employer].include?(params[:role]) ? params[:role] : nil,
      "return_to" => safe_return_to(params[:return_to]),
      "consent" => ActiveModel::Type::Boolean.new.cast(params[:consent]) == true,
      "owner_user_id" => owner_user&.id
    }, purpose: STATE_PURPOSE, expires_in: STATE_TTL)

    redirect_to GoogleOauth.authorize_url(state:, code_challenge: challenge), allow_other_host: true
  end

  # GET /auth/google/callback?code=&state=  (or ?error=... when the person cancels)
  def callback
    payload = read_state(params[:state])
    return redirect_with_error("state_mismatch") unless payload
    return redirect_with_error("provider_error", payload) if params[:error].present?

    begin
      tokens = GoogleOauth.exchange_code(code: params[:code], code_verifier: payload["verifier"])
      claims = GoogleOauth.verify_id_token(tokens[:id_token])
    rescue GoogleOauth::TokenExchangeError, GoogleOauth::VerificationError => e
      Rails.logger.warn({ event: "google_oauth_callback_failed", error: e.class.name }.to_json)
      return redirect_with_error("provider_error", payload)
    end

    owner_user = payload["owner_user_id"] && User.find_by(id: payload["owner_user_id"])
    return redirect_with_error("disabled", payload) if payload["intent"] == "connect" && owner_user.nil?

    result = GoogleSignIn.call(claims:, intent: payload["intent"], role: payload["role"], owner_user:, consent: payload["consent"])
    return redirect_to_choose_role(payload) if result.error == "role_required"
    return redirect_with_error(result.error, payload) unless result.ok?
    return redirect_with_error("disabled", payload) unless result.user.active?

    notify_linked(result.user) if result.notify_linked
    audit_google_sign_in(result, payload)
    result.user.update!(last_login_at: Time.current)
    token = sign_in(result.user)
    redirect_to success_url(result, payload, token), allow_other_host: true
  end

  private

  def state_verifier = Rails.application.message_verifier("google-oauth-state")

  def read_state(raw)
    return nil unless raw.is_a?(String) && raw.length <= 4096
    payload = state_verifier.verified(raw, purpose: STATE_PURPOSE)
    payload if payload.is_a?(Hash)
  rescue StandardError
    nil
  end

  # For intent=connect, the frontend's full-page navigation carries the already-signed-in
  # user's bearer token as a query parameter (there is no cookie to carry it instead).
  def user_from_query_token
    token = params[:token]
    return nil if token.blank?
    session = Session.active.find_by(token_digest: digest(token))
    session&.user
  end

  def safe_return_to(value)
    value.is_a?(String) && value.start_with?("/") && !value.start_with?("//") ? value.first(500) : nil
  end

  def sign_in(user)
    raw = SecureRandom.urlsafe_base64(48)
    Session.start!(user, token_digest: digest(raw), user_agent: request.user_agent)
    raw
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

  def success_url(result, payload, token)
    return_to = payload["return_to"] || default_return_to(result.user.role, result.created && !result.user.profile_complete)
    "#{frontend_url}#{return_to}?auth=google&token=#{CGI.escape(token)}"
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

  def frontend_url
    configured = ENV["FRONTEND_URL"].to_s.strip.sub(%r{/+\z}, "")
    configured.presence || (Rails.env.production? ? AuthController::PRODUCTION_FRONTEND_URL : "http://localhost:5173")
  end
end
