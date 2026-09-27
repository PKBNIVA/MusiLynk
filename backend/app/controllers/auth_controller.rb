class AuthController < ApplicationController
  LOGIN_FAILURE_PERIOD = 15.minutes
  # Strict budget per (email, IP) pair; a looser global per-email budget still
  # stops distributed guessing without letting one attacker lock a user out.
  LOGIN_FAILURES_PER_EMAIL_AND_IP = 10
  LOGIN_FAILURES_PER_EMAIL = 100
  LOGIN_FAILURES_PER_IP = 50
  MAX_LIVE_SESSIONS = 10
  OTP_REQUEST_PERIOD = 1.hour
  OTP_REQUESTS_PER_EMAIL = 5
  # Mobile carriers put many users behind one IP (CGNAT); the per-email limit is the real guard.
  OTP_REQUESTS_PER_IP = 30
  OTP_VERIFY_FAILURE_PERIOD = 15.minutes
  # Per-code attempts are capped by SignInCode::MAX_ATTEMPTS; this IP budget stops
  # one client spraying guesses across many addresses' codes.
  OTP_VERIFY_FAILURES_PER_IP = 25
  OTP_UNAVAILABLE_MESSAGE = "Email sign-in codes are temporarily unavailable. Use your password instead.".freeze
  OTP_REQUEST_MESSAGE = "If this email can be used on Verse, a 6-digit code is on its way. It expires in 10 minutes.".freeze
  OTP_INVALID_MESSAGE = "Invalid or expired code.".freeze
  EMAIL_SUPPRESSED_MESSAGE = "Email to this address bounced or was reported as spam, so Verse can no longer send to it. Use a different email address, or sign in with your password.".freeze
  PRODUCTION_FRONTEND_URL = "https://verse-music-platform.vercel.app".freeze
  # Admin password sign-in needs a second step: a code emailed to the admin.
  SECOND_FACTOR_PURPOSE = :admin_second_factor
  SECOND_FACTOR_CHALLENGES_PER_EMAIL = 5
  SECOND_FACTOR_CHALLENGE_PERIOD = 1.hour
  SECOND_FACTOR_FAILURES_PER_USER = 10
  SECOND_FACTOR_FAILURES_PER_IP = 25
  SECOND_FACTOR_FAILURE_PERIOD = 15.minutes
  SECOND_FACTOR_MESSAGE = "Admin sign-in needs one more step. We emailed a 6-digit code to your address. It expires in 10 minutes.".freeze
  SECOND_FACTOR_EXPIRED_MESSAGE = "This sign-in step has expired. Sign in with your password again.".freeze
  SECOND_FACTOR_UNAVAILABLE_MESSAGE = "Admin sign-in needs an emailed code, but email delivery is not configured on the server. Configure an email provider to sign in.".freeze
  SECOND_FACTOR_SKIPPED_WARNING = "Admin 2-step sign-in is off because email delivery is not configured. Add an email provider (BREVO_API_KEY), then set ADMIN_SECOND_FACTOR=required.".freeze
  SECOND_FACTOR_SUPPRESSED_WARNING = "Admin 2-step sign-in is off for this admin because email to their address is suppressed (bounced or reported as spam). Fix the address, then lift the suppression.".freeze
  SECOND_FACTOR_DISABLED_WARNING = "Admin 2-step sign-in is turned off (ADMIN_SECOND_FACTOR=off). Remove that setting once the emergency is over.".freeze

  # ADMIN_SECOND_FACTOR selects how an admin password sign-in is treated:
  #   "auto" (default, and any unrecognised value): require the emailed code when
  #     codes can be delivered; otherwise allow the password alone, audit it as
  #     auth.admin_second_factor_skipped and warn in the admin tester and sign-in
  #     doctor. Merging or misconfiguring email never locks admins out.
  #   "required": always require the code; without email delivery the password
  #     step fails closed (503 SECOND_FACTOR_UNAVAILABLE).
  #   "off": emergency disable only; every such sign-in is audited.
  # Outside production the on-screen debugCode counts as delivery. With an email
  # address, a suppressed (bounced or complained) address counts as undeliverable.
  # Returns :enforced, :unavailable (required but undeliverable), :skipped or :off.
  def self.admin_second_factor_state(email = nil)
    mode = ENV.fetch("ADMIN_SECOND_FACTOR", "auto").strip.downcase
    return :off if mode == "off"
    return :enforced if admin_code_deliverable?(email)
    mode == "required" ? :unavailable : :skipped
  end

  def self.admin_code_deliverable?(email)
    return !Rails.env.production? unless EmailDelivery.configured?
    email.blank? || !EmailSuppression.blocks_all?(email)
  end

  def register
    # Shared campus, office and mobile-carrier IPs sign up many real users; keep bulk abuse bounded.
    return unless throttle!("register", limit: 60, period: 1.hour)
    role = params[:role].to_s
    return render_error("Choose either a jobseeker or employer account.", :unprocessable_content, "INVALID_ROLE") unless %w[jobseeker employer].include?(role)

    user = User.create!(name: params[:name], email: params[:email], password: params[:password], role:, status: :active)
    user.create_profile!
    token = sign_in(user)
    verification_token = issue_token("verify_email", 24.hours, user)
    _verification_link, verification_delivery = deliver_token(verification_token, "/verify-email", user)
    audit!("auth.register", user)
    render json: { user: public_user(user), accessToken: token, verificationRequired: true, verificationDelivery: verification_delivery }, status: :created
  rescue ActiveRecord::RecordNotUnique
    render_error("An account already exists for this email.", :conflict)
  end

  def login
    unless password_login_enabled?
      return render_error("Password sign-in is turned off. Use an email sign-in code instead.", :forbidden, "PASSWORD_LOGIN_DISABLED")
    end
    email = normalized_email
    scopes = login_failure_scopes(email)
    return if failure_budget_exhausted?("login-failure", scopes, period: LOGIN_FAILURE_PERIOD)
    user = User.find_by(email:)
    unless user&.authenticate(params[:password])
      record_failure!("login-failure", scopes, period: LOGIN_FAILURE_PERIOD)
      return render_error("Incorrect email or password.", :unauthorized)
    end
    return render_error("This account is not active.", :forbidden) unless user.active?
    second_factor = user.admin? ? self.class.admin_second_factor_state(user.email) : nil
    return start_second_factor(user) if second_factor == :enforced
    if second_factor == :unavailable
      Rails.logger.error({ event: "admin_second_factor_unavailable", userId: user.id }.to_json)
      return render_error(SECOND_FACTOR_UNAVAILABLE_MESSAGE, :service_unavailable, "SECOND_FACTOR_UNAVAILABLE")
    end
    if second_factor == :skipped
      reason = EmailDelivery.configured? ? "email_suppressed" : "email_delivery_not_configured"
      Rails.logger.warn({ event: "admin_second_factor_skipped", userId: user.id, reason: }.to_json)
      audit!("auth.admin_second_factor_skipped", user, { reason:, ip: request.remote_ip })
    end

    user.update!(last_login_at: Time.current)
    token = sign_in(user)
    audit!("auth.login", user, second_factor ? { secondFactor: second_factor == :off ? "disabled" : "skipped" } : {})
    render json: { user: public_user(user), accessToken: token }
  end

  # POST /auth/second-factor {challengeToken, code} -> same shape as /auth/login.
  # Completes an admin password sign-in with the code emailed by the password step.
  def second_factor
    ip_scope = { ip: [request.remote_ip, SECOND_FACTOR_FAILURES_PER_IP] }
    return if failure_budget_exhausted?("second-factor-failure", ip_scope, period: SECOND_FACTOR_FAILURE_PERIOD)

    challenge = read_second_factor_challenge(params[:challengeToken])
    user = challenge && User.find_by(id: challenge["user"])
    code = user && SignInCode.find_by(id: challenge["code"], email: user.email)
    unless code
      record_failure!("second-factor-failure", ip_scope, period: SECOND_FACTOR_FAILURE_PERIOD)
      return render_error(SECOND_FACTOR_EXPIRED_MESSAGE, :unauthorized, "SECOND_FACTOR_EXPIRED")
    end

    scopes = ip_scope.merge(user: [user.id, SECOND_FACTOR_FAILURES_PER_USER])
    return if failure_budget_exhausted?("second-factor-failure", scopes, period: SECOND_FACTOR_FAILURE_PERIOD)
    unless consume_code(code, params[:code])
      record_failure!("second-factor-failure", scopes, period: SECOND_FACTOR_FAILURE_PERIOD)
      return render_error(OTP_INVALID_MESSAGE, :unauthorized, "OTP_INVALID")
    end
    return render_error("This account is not active.", :forbidden) unless user.active?

    user.update!(last_login_at: Time.current)
    token = sign_in(user)
    audit!("auth.login", user, { method: "password", secondFactor: "email_code" })
    render json: { user: public_user(user), accessToken: token }
  end

  # POST /auth/otp/request {email, role?, name?}
  # Always answers with the same body, whether or not an account exists: an
  # existing account gets a sign-in code; an unknown address with name+role gets
  # a sign-up code (the account is created on verify); any other address gets an
  # unusable placeholder row so the work done per request is the same.
  # GET /auth/methods -> which sign-in paths work right now, so the sign-in page never
  # offers an emailed code (or a reset link) that cannot be delivered.
  def sign_in_methods
    render json: { signInCodes: sign_in_codes_available?, password: password_login_enabled?, emailDelivery: EmailDelivery.configured? }
  end

  def otp_request
    return render_error(OTP_UNAVAILABLE_MESSAGE, :service_unavailable, "OTP_UNAVAILABLE") unless sign_in_codes_available?
    email = normalized_email
    return render_error("Enter a valid email address.", :unprocessable_content, "INVALID_EMAIL") unless email.match?(URI::MailTo::EMAIL_REGEXP) && email.length <= 254
    sign_up = otp_sign_up_params
    return if performed?

    scopes = { email: [email, OTP_REQUESTS_PER_EMAIL], ip: [request.remote_ip, OTP_REQUESTS_PER_IP] }
    return if failure_budget_exhausted?("otp-request", scopes, period: OTP_REQUEST_PERIOD)
    record_failure!("otp-request", scopes, period: OTP_REQUEST_PERIOD)
    # A code sent to a hard-bounced or complaining address can never arrive: say so instead
    # of leaving the person waiting. Checked after the throttle so it cannot be probed quickly.
    return render_error(EMAIL_SUPPRESSED_MESSAGE, :unprocessable_content, "EMAIL_SUPPRESSED") if EmailSuppression.blocks_all?(email)

    user = User.find_by(email:)
    pending = user ? {} : sign_up.to_h
    record, code = SignInCode.issue!(email:, pending_name: pending[:name], pending_role: pending[:role])
    if user || record.sign_up?
      queue_sign_in_code(user:, email:, code:)
    else
      record.update_columns(used_at: record.created_at)
    end

    result = { ok: true, message: OTP_REQUEST_MESSAGE, expiresIn: SignInCode::LIFETIME.to_i }
    # Local QA without an email provider only. Never in production, and the same
    # for every address (an unknown address gets an unusable code).
    result[:debugCode] = code if !Rails.env.production? && !EmailDelivery.configured?
    render json: result
  end

  # POST /auth/otp/verify {email, code} -> same shape as /auth/login.
  def otp_verify
    email = normalized_email
    ip_scope = { ip: [request.remote_ip, OTP_VERIFY_FAILURES_PER_IP] }
    return if failure_budget_exhausted?("otp-verify-failure", ip_scope, period: OTP_VERIFY_FAILURE_PERIOD)

    code = consume_sign_in_code(email, params[:code])
    unless code
      record_failure!("otp-verify-failure", ip_scope, period: OTP_VERIFY_FAILURE_PERIOD)
      return render_error(OTP_INVALID_MESSAGE, :unauthorized, "OTP_INVALID")
    end

    user = User.find_by(email:)
    created = false
    if user.nil? && code.sign_up?
      user, created = create_user_from_code(code)
    end
    return render_error(OTP_INVALID_MESSAGE, :unauthorized, "OTP_INVALID") unless user
    return render_error("This account is not active.", :forbidden) unless user.active?

    user.update!(email_verified: true, last_login_at: Time.current)
    token = sign_in(user)
    audit!(created ? "auth.register" : "auth.login", user, { method: "email_code" })
    render json: { user: public_user(user), accessToken: token }
  end

  def logout
    raw = request.authorization.to_s.match(/^Bearer\s+(.+)$/i)&.captures&.first
    Session.find_by(token_digest: digest(raw))&.destroy!
    render json: { ok: true }
  end

  def me
    return unless authenticate!
    render json: { user: public_user(current_user) }
  end

  def request_verification
    return unless authenticate!
    return unless throttle!("email-verification", limit: 5, period: 1.hour)
    return render json: { ok: true, alreadyVerified: true } if current_user.email_verified?
    token = issue_token("verify_email", 24.hours)
    render json: token_response(token, "/verify-email", current_user)
  end

  def verify_email
    token = EmailToken.usable("verify_email").find_by(token_digest: digest(params[:token]))
    return render_error("Verification link is invalid or expired.", :bad_request, "TOKEN_INVALID") unless token
    token.with_lock do
      return render_error("Verification link is invalid or expired.", :bad_request, "TOKEN_INVALID") if token.used_at? || token.expires_at <= Time.current
      token.update!(used_at: Time.current)
      token.user.update!(email_verified: true)
    end
    render json: { ok: true }
  end

  def forgot_password
    return unless throttle!("password-reset", limit: 10, period: 1.hour)
    if (user = User.find_by(email: normalized_email))
      token = issue_token("reset_password", 2.hours, user)
      _link, delivery = deliver_token(token, "/reset-password", user)
      unless delivery[:queued]
        Rails.logger.warn({ event: "password_reset_email_skipped", userId: user.id, reason: delivery[:reason] }.to_json)
      end
    else
      Rails.logger.info({ event: "password_reset_unknown_account" }.to_json)
    end
    render json: { ok: true, message: "If an account exists, password reset instructions have been sent." }
  end

  def reset_password
    return render_error("Password must be at least 10 characters.", :bad_request) if params[:password].to_s.length < 10
    token = EmailToken.usable("reset_password").find_by(token_digest: digest(params[:token]))
    return render_error("Reset link is invalid or expired.", :bad_request, "TOKEN_INVALID") unless token
    token.with_lock do
      return render_error("Reset link is invalid or expired.", :bad_request, "TOKEN_INVALID") if token.used_at? || token.expires_at <= Time.current
      token.user.update!(password: params[:password])
      token.update!(used_at: Time.current)
      token.user.sessions.delete_all
      token.user.email_tokens.usable("reset_password").update_all(used_at: Time.current)
    end
    render json: { ok: true }
  end

  private

  def sign_in(user)
    raw = SecureRandom.urlsafe_base64(48)
    Session.start!(user, token_digest: digest(raw), user_agent: request.user_agent)
    user.sessions.where(id: user.sessions.order(created_at: :desc).offset(MAX_LIVE_SESSIONS).select(:id)).delete_all
    raw
  end

  def issue_token(purpose, lifetime, user = current_user)
    raw = SecureRandom.urlsafe_base64(48)
    user.email_tokens.where(purpose:, used_at: nil).update_all(used_at: Time.current)
    user.email_tokens.create!(purpose:, token_digest: digest(raw), expires_at: lifetime.from_now)
    raw
  end

  def normalized_email = params[:email].to_s.strip.downcase

  def password_login_enabled? = ENV.fetch("PASSWORD_LOGIN_ENABLED", "true").strip.downcase != "false"

  # Outside production a missing provider falls back to the on-screen debug code.
  def sign_in_codes_available? = EmailDelivery.configured? || !Rails.env.production?

  # Validated the same way whether or not the address has an account, so a
  # validation error never reveals account existence. Returns nil for sign-in.
  def otp_sign_up_params
    role = params[:role].to_s.strip
    name = params[:name].to_s.strip
    return nil if role.blank? && name.blank?
    unless SignInCode::SIGN_UP_ROLES.include?(role)
      render_error("Choose either a jobseeker or employer account.", :unprocessable_content, "INVALID_ROLE")
      return nil
    end
    unless name.length.between?(2, 120)
      render_error("Enter a name between 2 and 120 characters.", :unprocessable_content, "INVALID_NAME")
      return nil
    end
    { name:, role: }
  end

  # Spends one attempt on the newest usable code for the address and returns it
  # (marked used) when the code matches. The row lock serialises concurrent
  # guesses so the attempt cap cannot be raced.
  def consume_sign_in_code(email, raw)
    candidate = SignInCode.latest_usable_for(email)
    # Keep the no-code path doing the same HMAC work as the has-code path.
    unless candidate
      SignInCode.new(id: "sign_placeholder", code_digest: "").matches?(raw)
      return nil
    end
    consume_code(candidate, raw)
  end

  def consume_code(candidate, raw)
    matched = false
    candidate.with_lock do
      next if candidate.used_at? || candidate.expires_at <= Time.current || candidate.attempts >= SignInCode::MAX_ATTEMPTS
      candidate.attempts += 1
      matched = candidate.matches?(raw)
      candidate.used_at = Time.current if matched || candidate.attempts >= SignInCode::MAX_ATTEMPTS
      candidate.save!
    end
    candidate if matched
  end

  # The password was right; answer with a short-lived challenge instead of a
  # session and email the admin a code that completes it.
  def start_second_factor(user)
    scopes = { email: [user.email, SECOND_FACTOR_CHALLENGES_PER_EMAIL] }
    return if failure_budget_exhausted?("second-factor-challenge", scopes, period: SECOND_FACTOR_CHALLENGE_PERIOD)
    record_failure!("second-factor-challenge", scopes, period: SECOND_FACTOR_CHALLENGE_PERIOD)

    record, code = SignInCode.issue!(email: user.email)
    queue_sign_in_code(user:, email: user.email, code:)
    audit!("auth.second_factor_challenge", user, { ip: request.remote_ip })
    challenge = second_factor_verifier.generate({ "user" => user.id, "code" => record.id }, purpose: SECOND_FACTOR_PURPOSE, expires_in: SignInCode::LIFETIME)
    result = { secondFactorRequired: true, method: "email_code", challengeToken: challenge, message: SECOND_FACTOR_MESSAGE, expiresIn: SignInCode::LIFETIME.to_i }
    result[:debugCode] = code if !Rails.env.production? && !EmailDelivery.configured?
    render json: result, status: :accepted
  end

  def read_second_factor_challenge(token)
    return nil unless token.is_a?(String) && token.length <= 1024
    payload = second_factor_verifier.verified(token, purpose: SECOND_FACTOR_PURPOSE)
    payload if payload.is_a?(Hash)
  end

  def second_factor_verifier = Rails.application.message_verifier("admin-second-factor")

  def create_user_from_code(code)
    user = User.transaction do
      created = User.create!(name: code.pending_name, email: code.email, role: code.pending_role, status: :active,
        email_verified: true, password: SecureRandom.base58(32))
      created.create_profile!
      created
    end
    [user, true]
  rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
    # Registered by another path since the code was sent; the verifier still
    # proved control of the inbox, so sign in to that account.
    [User.find_by(email: code.email), false]
  end

  def queue_sign_in_code(user:, email:, code:)
    return unless EmailDelivery.configured?
    user ? EmailDeliveryJob.enqueue_code(template: "sign_in_code", code:, user:) : EmailDeliveryJob.enqueue_code(template: "sign_in_code", code:, email:)
  rescue StandardError => error
    # The response must not differ, so a queueing failure is only logged.
    Rails.logger.error({ event: "email_enqueue_failed", template: "sign_in_code", error: error.class.name }.to_json)
    ErrorReporter.capture(error, tags: { source: "email_enqueue_failed", template: "sign_in_code" })
  end

  def login_failure_scopes(email)
    {
      email_ip: [email.presence && "#{email}|#{request.remote_ip}", LOGIN_FAILURES_PER_EMAIL_AND_IP],
      email: [email, LOGIN_FAILURES_PER_EMAIL],
      ip: [request.remote_ip, LOGIN_FAILURES_PER_IP]
    }
  end

  def token_response(token, path, user)
    link, delivery = deliver_token(token, path, user)
    result = { ok: true, delivery: }
    result[:debugLink] = link unless Rails.env.production?
    result
  end

  # Builds the link and queues delivery. The returned hash is the public
  # `delivery`/`verificationDelivery` contract: { queued: true } once a provider
  # job is enqueued, otherwise { queued: false, delivered: false, reason: }.
  def deliver_token(token, path, user)
    link = "#{frontend_url}#{path}?token=#{CGI.escape(token)}"
    template = path.include?("reset") ? "reset_password" : "verify_email"
    [link, queue_email(user, template, link)]
  end

  def queue_email(user, template, link)
    return { queued: false, delivered: false, reason: "Recipient unavailable" } if user&.email.blank?
    return { queued: false, delivered: false, reason: "Email provider not configured" } unless EmailDelivery.configured?
    return { queued: false, delivered: false, reason: "Email address suppressed" } if EmailSuppression.blocks_all?(user.email)
    EmailDeliveryJob.enqueue(user:, template:, link:)
    { queued: true }
  rescue StandardError => error
    # The account/token already exists; report the failure instead of a 500.
    Rails.logger.error({ event: "email_enqueue_failed", template:, error: error.class.name }.to_json)
    ErrorReporter.capture(error, tags: { source: "email_enqueue_failed", template: })
    { queued: false, delivered: false, reason: "delivery error" }
  end

  def frontend_url
    configured = ENV["FRONTEND_URL"].to_s.strip.sub(%r{/+\z}, "")
    return configured if configured.present?
    return "http://localhost:5173" unless Rails.env.production?

    Rails.logger.error({ event: "frontend_url_missing", fallback: PRODUCTION_FRONTEND_URL }.to_json)
    PRODUCTION_FRONTEND_URL
  end
end
