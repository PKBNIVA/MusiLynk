require "test_helper"

# A signed-in professional/employer changes their own name, email (proved by a code sent
# to the new address, mirroring Admin::AccountController) and password, plus password
# strength and the reset-password link pre-check (FORM-13, 14, 15).
class AccountSettingsTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  PASSWORD = "StrongPass123!".freeze
  PROVIDER_ENV = { "EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send", "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil }.freeze
  NO_PROVIDER_ENV = { "EMAIL_DELIVERY_WEBHOOK" => nil, "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil }.freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @user = User.create!(name: "Maya Session", email: "maya@example.com", password: PASSWORD, role: "jobseeker", status: "active", password_set_at: Time.current)
    @other_user = User.create!(name: "Other Member", email: "other@example.com", password: PASSWORD, role: "employer", status: "active")
    @token = session_for(@user)
    @other_browser = session_for(@user)
  end

  teardown { Rails.cache = @original_cache }

  test "changing the name updates it and audits it" do
    patch "/api/account/name", params: { name: "Maya New Session" }, headers: bearer(@token), as: :json
    assert_response :success
    assert_equal "Maya New Session", response.parsed_body.dig("user", "name")
    assert_equal "Maya New Session", @user.reload.name
    assert AuditLog.exists?(actor: @user, action: "account.name_changed")

    patch "/api/account/name", params: { name: "a" }, headers: bearer(@token), as: :json
    assert_response :unprocessable_content
    assert_equal "INVALID_NAME", response.parsed_body["code"]
  end

  test "changing the email sends a code to the new address, then moves the account, signs out other browsers and tells the old address" do
    challenge = with_env(PROVIDER_ENV) do
      assert_enqueued_jobs 1, only: EmailDeliveryJob do
        request_change("New-Address@Example.com ")
      end
      assert_response :accepted
      response.parsed_body
    end
    assert_equal %w[changeToken expiresIn message], challenge.keys.sort
    assert_equal "maya@example.com", @user.reload.email, "nothing changes until the code is entered"
    requested = AuditLog.where(action: "account.email_requested").sole
    assert_equal [@user.id, @user.id, { "email" => "new-address@example.com" }], [requested.actor_id, requested.entity_id, requested.metadata]

    job = enqueued_jobs.find { _1[:job] == EmailDeliveryJob }
    user_id, template, sealed_code, sealed_email = ActiveJob::Arguments.deserialize(job[:args])
    assert_nil user_id
    assert_equal "account_email_change", template
    code = EmailDeliveryJob.unseal(sealed_code)
    assert_equal "new-address@example.com", EmailDeliveryJob.unseal(sealed_email, purpose: EmailDeliveryJob::RECIPIENT_PURPOSE)
    clear_enqueued_jobs

    get "/api/me", headers: bearer(@other_browser)
    assert_response :success, "the other browser is still signed in before the change"

    with_env(PROVIDER_ENV) do
      assert_enqueued_jobs 1, only: EmailDeliveryJob do
        confirm(challenge["changeToken"], code)
      end
    end
    assert_response :success
    assert_equal "new-address@example.com", response.parsed_body.dig("user", "email")
    assert_equal true, response.parsed_body.dig("user", "emailVerified")
    assert_equal "new-address@example.com", @user.reload.email
    changed = AuditLog.where(action: "account.email_changed").sole
    assert_equal({ "from" => "maya@example.com", "to" => "new-address@example.com" }, changed.metadata)

    notice = enqueued_jobs.find { _1[:job] == EmailDeliveryJob }
    _uid, notice_template, sealed_detail, sealed_notice_email = ActiveJob::Arguments.deserialize(notice[:args])
    assert_equal "account_email_changed", notice_template
    assert_equal "new-address@example.com", EmailDeliveryJob.unseal(sealed_detail)
    assert_equal "maya@example.com", EmailDeliveryJob.unseal(sealed_notice_email, purpose: EmailDeliveryJob::RECIPIENT_PURPOSE)

    get "/api/me", headers: bearer(@token)
    assert_response :success, "the browser that made the change stays signed in"
    get "/api/me", headers: bearer(@other_browser)
    assert_response :unauthorized, "every other browser is signed out"
  end

  test "reserved, suppressed, taken and unchanged addresses are refused and send nothing" do
    EmailSuppression.create!(email: "bounced@example.com", scope: "all", reason: "hard_bounce", last_event: "hard_bounce", last_event_at: Time.current, suppressed_at: Time.current)
    refusals = {
      "member@verse.local" => [422, "EMAIL_UNDELIVERABLE"],
      "bounced@example.com" => [422, "EMAIL_SUPPRESSED"],
      "Other@example.com" => [409, "EMAIL_TAKEN"],
      "maya@example.com" => [422, "EMAIL_UNCHANGED"],
      "not-an-email" => [422, "INVALID_EMAIL"]
    }
    with_env(PROVIDER_ENV) do
      assert_no_enqueued_jobs do
        refusals.each do |email, (status, code)|
          Rails.cache.clear
          request_change(email)
          assert_equal [status, code], [response.status, response.parsed_body["code"]], email.inspect
        end
      end
    end
  end

  test "email change requests are limited to five an hour" do
    AccountController::EMAIL_CHANGE_REQUESTS_PER_HOUR.times do |index|
      request_change("addr#{index}@example.com")
      assert_response :accepted
    end
    request_change("addr-late@example.com")
    assert_response :too_many_requests
  end

  test "a wrong code is limited and never changes the email; a change token belongs to the account that requested it" do
    token, code = change_for(@user, "new@example.com")
    wrong = code == "111111" ? "222222" : "111111"
    SignInCode::MAX_ATTEMPTS.times do
      confirm(token, wrong)
      assert_response :unprocessable_content
    end
    confirm(token, code)
    assert_response :unprocessable_content
    assert_equal "maya@example.com", @user.reload.email

    token2, code2 = change_for(@user, "someone-else@example.com")
    confirm(token2, code2, token: session_for(@other_user))
    assert_response :unprocessable_content
    assert_equal "EMAIL_CHANGE_EXPIRED", response.parsed_body["code"]
  end

  test "an address taken between the request and the code is refused at confirmation" do
    token, code = change_for(@user, "fast@example.com")
    User.create!(name: "Fast Registrant", email: "fast@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    confirm(token, code)
    assert_response :conflict
    assert_equal "EMAIL_TAKEN", response.parsed_body["code"]
  end

  test "changing the password needs the current one, enforces strength, signs out other browsers and is audited" do
    change_password("wrong-password", "BrandNewPass456!")
    assert_response :forbidden
    assert_equal "PASSWORD_INCORRECT", response.parsed_body["code"]

    change_password(PASSWORD, "short")
    assert_response :unprocessable_content
    assert_equal "PASSWORD_WEAK", response.parsed_body["code"]

    change_password(PASSWORD, "password123")
    assert_response :unprocessable_content
    assert_equal "PASSWORD_WEAK", response.parsed_body["code"]

    change_password(PASSWORD, "maya1234567")
    assert_response :unprocessable_content
    assert_equal "PASSWORD_WEAK", response.parsed_body["code"], "contains the email local part"

    change_password(PASSWORD, PASSWORD)
    assert_response :unprocessable_content
    assert_equal "PASSWORD_UNCHANGED", response.parsed_body["code"]
    assert_equal 2, @user.sessions.count, "nothing changed yet"

    @user.email_tokens.create!(purpose: "reset_password", token_digest: Digest::SHA256.hexdigest("reset"), expires_at: 1.hour.from_now)
    change_password(PASSWORD, "BrandNewPass456!")
    assert_response :success
    assert @user.reload.authenticate("BrandNewPass456!")
    assert_equal 0, @user.email_tokens.usable("reset_password").count
    assert AuditLog.exists?(actor: @user, action: "account.password_changed")

    get "/api/me", headers: bearer(@token)
    assert_response :success
    get "/api/me", headers: bearer(@other_browser)
    assert_response :unauthorized
  end

  test "an account with no password of its own sets a first one without a current password" do
    codeonly = User.create!(name: "Code Only", email: "codeonly@example.com", password: SecureRandom.base58(32), role: "jobseeker", status: "active", email_verified: true)
    assert_not codeonly.password_set?
    token = session_for(codeonly)
    other_device = session_for(codeonly)

    get "/api/me", headers: bearer(token)
    assert_equal false, response.parsed_body.dig("user", "passwordSet")

    post "/api/account/password", params: { newPassword: "short" }, headers: bearer(token), as: :json
    assert_response :unprocessable_content

    with_env(PROVIDER_ENV) do
      assert_enqueued_jobs 1, only: EmailDeliveryJob do
        post "/api/account/password", params: { newPassword: "BrandNewPass456!" }, headers: bearer(token), as: :json
      end
    end
    assert_response :success
    assert codeonly.reload.password_set?
    notice = enqueued_jobs.find { _1[:job] == EmailDeliveryJob }
    _uid, notice_template, sealed_detail, sealed_notice_email = ActiveJob::Arguments.deserialize(notice[:args])
    assert_equal "account_password_set", notice_template
    assert_equal "codeonly@example.com", EmailDeliveryJob.unseal(sealed_detail)
    assert_equal "codeonly@example.com", EmailDeliveryJob.unseal(sealed_notice_email, purpose: EmailDeliveryJob::RECIPIENT_PURPOSE)
    assert AuditLog.exists?(actor: codeonly, action: "account.password_set")
    get "/api/me", headers: bearer(other_device)
    assert_response :success, "adding a first password does not sign out the other devices"

    post "/api/auth/login", params: { email: codeonly.email, password: "BrandNewPass456!" }, as: :json
    assert_response :success

    change_password("WrongPass123!x", "AnotherNewPass789!", token:)
    assert_response :forbidden, "once a password exists the current one is required"

    clear_enqueued_jobs
    with_env(PROVIDER_ENV) do
      assert_no_enqueued_jobs only: EmailDeliveryJob do
        change_password("BrandNewPass456!", "AnotherNewPass789!", token:)
      end
    end
    assert_response :success
  end

  test "the password-added notice renders the account and a recovery path without a link" do
    content = EmailDelivery::TEMPLATES.fetch("account_password_set")
    text = EmailDelivery.send(:email_text, content:, data: { detail: "codeonly@example.com" })
    assert_includes text, "A password was just added"
    assert_includes text, "codeonly@example.com"
    assert_includes text, "If you did not"
    assert_no_match %r{https?://}, text
  end

  test "signing in with a password to a code-only account says it uses email codes" do
    codeonly = User.create!(name: "Code Only", email: "codeonly2@example.com", password: SecureRandom.base58(32), role: "jobseeker", status: "active", email_verified: true)
    post "/api/auth/login", params: { email: codeonly.email, password: "GuessedPass123!" }, as: :json
    assert_response :unauthorized
    assert_equal "USE_EMAIL_CODE", response.parsed_body["code"]
    assert_match(/email codes/, response.parsed_body["error"])

    post "/api/auth/login", params: { email: @user.email, password: "wrong-password" }, as: :json
    assert_equal "Incorrect email or password.", response.parsed_body["error"]
  end

  test "wrong current passwords are limited per account" do
    AccountController::PASSWORD_FAILURES_PER_USER.times do
      change_password("wrong-password", "BrandNewPass456!")
      assert_response :forbidden
    end
    change_password(PASSWORD, "BrandNewPass456!")
    assert_response :too_many_requests
    assert @user.reload.authenticate(PASSWORD)
  end

  test "register and reset-password reject a weak, common or self-identifying password" do
    post "/api/auth/register", params: { name: "Weak Password", email: "weak@example.com", password: "short", role: "jobseeker" }, as: :json
    assert_response :unprocessable_content

    post "/api/auth/register", params: { name: "Weak Password", email: "weak@example.com", password: "password123", role: "jobseeker" }, as: :json
    assert_response :unprocessable_content

    post "/api/auth/register", params: { name: "Weak Password", email: "weak@example.com", password: "weakpassword99", role: "jobseeker" }, as: :json
    assert_response :unprocessable_content, "contains the email local part"

    post "/api/auth/register", params: { name: "Weak Password", email: "weak@example.com", password: "GoodPass1234!", role: "jobseeker" }, as: :json
    assert_response :created
  end

  test "the reset-password link is checked before use, tells the account's role, and signs in on success" do
    get "/api/auth/reset-password/check", params: { token: "not-a-real-token" }
    assert_response :success
    assert_equal({ "valid" => false }, response.parsed_body)

    raw = SecureRandom.urlsafe_base64(48)
    @user.email_tokens.create!(purpose: "reset_password", token_digest: Digest::SHA256.hexdigest(raw), expires_at: 2.hours.from_now)

    get "/api/auth/reset-password/check", params: { token: raw }
    assert_response :success
    assert_equal({ "valid" => true, "role" => "jobseeker" }, response.parsed_body)

    post "/api/auth/reset-password", params: { token: raw, password: "short" }, as: :json
    assert_response :bad_request
    assert_equal "PASSWORD_WEAK", response.parsed_body["code"]

    post "/api/auth/reset-password", params: { token: raw, password: "BrandNewPass456!" }, as: :json
    assert_response :success
    assert_equal "maya@example.com", response.parsed_body.dig("user", "email")
    assert response.parsed_body["accessToken"].present?, "the reset signs the account straight in"
    assert @user.reload.authenticate("BrandNewPass456!")
    assert_equal 1, @user.sessions.count, "the old sessions were revoked, and the reset started exactly one new one"

    get "/api/auth/reset-password/check", params: { token: raw }
    assert_response :success
    assert_equal({ "valid" => false }, response.parsed_body)

    post "/api/auth/reset-password", params: { token: raw, password: "AnotherPass789!" }, as: :json
    assert_response :bad_request
    assert_equal "TOKEN_INVALID", response.parsed_body["code"]
  end

  test "an expired reset-password link is reported as invalid" do
    raw = SecureRandom.urlsafe_base64(48)
    @user.email_tokens.create!(purpose: "reset_password", token_digest: Digest::SHA256.hexdigest(raw), expires_at: 1.hour.ago)
    get "/api/auth/reset-password/check", params: { token: raw }
    assert_response :success
    assert_equal({ "valid" => false }, response.parsed_body)
  end

  private

  def request_change(email, token: @token)
    post "/api/account/email/request", params: { email: }, headers: bearer(token), as: :json
  end

  def change_for(user, email)
    with_env(NO_PROVIDER_ENV) { request_change(email, token: session_for(user)) }
    assert_response :accepted
    [response.parsed_body.fetch("changeToken"), response.parsed_body.fetch("debugCode")]
  end

  def confirm(change_token, code, token: @token)
    post "/api/account/email/confirm", params: { changeToken: change_token, code: }, headers: bearer(token), as: :json
  end

  def change_password(current, fresh, token: @token)
    post "/api/account/password", params: { currentPassword: current, newPassword: fresh }, headers: bearer(token), as: :json
  end

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    Session.start!(user, token_digest: Digest::SHA256.hexdigest(raw), user_agent: nil)
    raw
  end

  def bearer(token) = { "Authorization" => "Bearer #{token}" }

  def with_env(values)
    previous = values.keys.index_with { ENV[_1] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
