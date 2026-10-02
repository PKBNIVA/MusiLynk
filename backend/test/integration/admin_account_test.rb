require "test_helper"
require "minitest/mock"

# An admin changes their own email (proved by a code sent to the new address) and password
# from the admin site. Both changes sign out every other browser and are audited.
class AdminAccountTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  PASSWORD = "StrongPass123!".freeze
  PROVIDER_ENV = { "EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send", "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil }.freeze
  NO_PROVIDER_ENV = { "EMAIL_DELIVERY_WEBHOOK" => nil, "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil }.freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @admin = User.create!(name: "Owner Admin", email: "admin@musilynk.local", password: PASSWORD, role: "admin", status: "active")
    @other_admin = User.create!(name: "Second Admin", email: "second-admin@example.com", password: PASSWORD, role: "admin", status: "active")
    @member = User.create!(name: "Plain Member", email: "member@example.com", password: PASSWORD, role: "employer", status: "active")
    @token = session_for(@admin)
    @other_browser = session_for(@admin)
  end

  teardown do
    Rails.cache = @original_cache
  end

  test "the account view reports the address, its deliverability, the second step and the origin lock" do
    with_env(PROVIDER_ENV) { get "/api/admin/account", headers: bearer(@token) }
    assert_response :success
    assert_equal({ "email" => "admin@musilynk.local", "emailDeliverable" => false, "secondFactor" => "skipped", "adminOrigin" => false }, response.parsed_body)

    with_env(PROVIDER_ENV.merge("ADMIN_ORIGIN" => "https://admin.example.com")) do
      get "/api/admin/account", headers: bearer(session_for(@other_admin)).merge("Origin" => "https://admin.example.com")
    end
    assert_response :success
    assert_equal({ "email" => "second-admin@example.com", "emailDeliverable" => true, "secondFactor" => "enforced", "adminOrigin" => true }, response.parsed_body)

    EmailSuppression.create!(email: @other_admin.email, scope: "all", reason: "hard_bounce", last_event: "hard_bounce", last_event_at: Time.current, suppressed_at: Time.current)
    with_env(PROVIDER_ENV.merge("ADMIN_SECOND_FACTOR" => "required")) { get "/api/admin/account", headers: bearer(session_for(@other_admin)) }
    assert_equal({ "emailDeliverable" => false, "secondFactor" => "unavailable" }, response.parsed_body.slice("emailDeliverable", "secondFactor"))

    get "/api/admin/account", headers: bearer(session_for(@member))
    assert_response :forbidden
    get "/api/admin/account"
    assert_response :unauthorized
  end

  test "changing the email sends a code to the new address, then moves the account, signs out other browsers and tells the old address" do
    challenge = with_env(PROVIDER_ENV) do
      assert_enqueued_jobs 1, only: EmailDeliveryJob do
        request_change("Owner@Example.com ")
      end
      assert_response :accepted
      response.parsed_body
    end
    assert_equal %w[changeToken expiresIn message], challenge.keys.sort
    assert_equal 600, challenge["expiresIn"]
    assert_equal "admin@musilynk.local", @admin.reload.email, "nothing changes until the code is entered"
    requested = AuditLog.where(action: "admin.account.email_requested").sole
    assert_equal [@admin.id, @admin.id, { "email" => "owner@example.com" }], [requested.actor_id, requested.entity_id, requested.metadata]

    job = enqueued_jobs.find { _1[:job] == EmailDeliveryJob }
    user_id, template, sealed_code, sealed_email = ActiveJob::Arguments.deserialize(job[:args])
    assert_nil user_id, "the recipient is the new address, not the user's current one"
    assert_equal "admin_email_change", template
    code = EmailDeliveryJob.unseal(sealed_code)
    assert_equal "owner@example.com", EmailDeliveryJob.unseal(sealed_email, purpose: EmailDeliveryJob::RECIPIENT_PURPOSE)
    assert_not_includes job[:args].to_json, "owner@example.com"
    assert_not_includes challenge["changeToken"], code
    clear_enqueued_jobs
    get "/api/me", headers: bearer(@other_browser)
    assert_response :success, "the other browser is still signed in before the change"

    with_env(PROVIDER_ENV) do
      assert_no_enqueued_jobs(only: EmailDeliveryJob) { confirm(challenge["changeToken"], code) }
    end
    assert_response :success
    assert_equal %w[user], response.parsed_body.keys
    assert_equal "owner@example.com", response.parsed_body.dig("user", "email")
    assert_equal true, response.parsed_body.dig("user", "emailVerified")
    assert_equal "owner@example.com", @admin.reload.email
    assert @admin.email_verified?
    changed = AuditLog.where(action: "admin.account.email_changed").sole
    assert_equal({ "from" => "admin@musilynk.local", "to" => "owner@example.com" }, changed.metadata)
    assert_equal @admin.id, changed.actor_id

    get "/api/me", headers: bearer(@token)
    assert_response :success, "the browser that made the change stays signed in"
    assert_equal 1, @admin.sessions.count
    get "/api/me", headers: bearer(@other_browser)
    assert_response :unauthorized, "every other browser is signed out"

    confirm(challenge["changeToken"], code)
    assert_response :unprocessable_content, "the code is single-use"
    assert_equal "OTP_INVALID", response.parsed_body["code"]
  end

  test "the previous address gets a notice when it can receive mail" do
    @admin.update!(email: "old-owner@example.com")
    token, code = change_for(@admin, "new-owner@example.com")
    with_env(PROVIDER_ENV) do
      assert_enqueued_jobs 1, only: EmailDeliveryJob do
        confirm(token, code, token: session_for(@admin))
      end
    end
    assert_response :success
    job = enqueued_jobs.find { _1[:job] == EmailDeliveryJob }
    user_id, template, sealed_detail, sealed_email = ActiveJob::Arguments.deserialize(job[:args])
    assert_nil user_id
    assert_equal "admin_email_changed", template
    assert_equal "new-owner@example.com", EmailDeliveryJob.unseal(sealed_detail)
    assert_equal "old-owner@example.com", EmailDeliveryJob.unseal(sealed_email, purpose: EmailDeliveryJob::RECIPIENT_PURPOSE)
    assert_not_includes job[:args].to_json, "owner@example.com"

    sent = nil
    EmailDelivery.stub(:call, ->(**kwargs) { sent = kwargs; { delivered: true, status: 200 } }) do
      EmailDeliveryJob.perform_now(*ActiveJob::Arguments.deserialize(job[:args]))
    end
    assert_equal ["old-owner@example.com", "admin_email_changed", { detail: "new-owner@example.com" }], sent.values_at(:to, :template, :data)
  end

  test "the change and notice emails render without links and with their own warnings" do
    with_env("BREVO_API_KEY" => "k", "BREVO_SENDER_EMAIL" => "sender@example.com") do
      bodies = {}
      transport = lambda do |_url, &configure|
        request = Struct.new(:headers, :body, :options).new({}, nil, Struct.new(:open_timeout, :timeout).new)
        configure.call(request)
        message = JSON.parse(request.body)
        bodies[message["subject"]] = message
        Struct.new(:status) { def success? = true }.new(201)
      end
      Faraday.stub(:post, transport) do
        EmailDelivery.call(to: "a@example.com", template: "admin_email_change", data: { code: "042917" })
        EmailDelivery.call(to: "a@example.com", template: "admin_email_changed", data: { detail: "new@example.com" })
      end
      change = bodies.fetch("Confirm your new MusiLynk admin email")
      assert_includes change["textContent"], "042917"
      assert_includes change["htmlContent"], "042917"
      assert_includes change["htmlContent"], "change your admin password now"
      assert_not_includes change["htmlContent"], "href="
      notice = bodies.fetch("Your MusiLynk admin email was changed")
      assert_includes notice["textContent"], "new@example.com"
      assert_includes notice["htmlContent"], "new@example.com"
      assert_includes notice["htmlContent"], "change your password"
      assert_not_includes notice["htmlContent"], "href="
      assert_not_includes notice["htmlContent"], "safely ignore"
    end
  end

  test "reserved, suppressed, taken, unchanged and malformed addresses are refused and send nothing" do
    EmailSuppression.create!(email: "bounced@example.com", scope: "all", reason: "hard_bounce", last_event: "hard_bounce", last_event_at: Time.current, suppressed_at: Time.current)
    refusals = {
      "root@musilynk.local" => [422, "EMAIL_UNDELIVERABLE"], "qa@example.invalid" => [422, "EMAIL_UNDELIVERABLE"],
      "bounced@example.com" => [422, "EMAIL_SUPPRESSED"],
      "member@example.com" => [409, "EMAIL_TAKEN"], "Second-Admin@example.com" => [409, "EMAIL_TAKEN"],
      "admin@musilynk.local" => [422, "EMAIL_UNCHANGED"],
      "not-an-email" => [422, "INVALID_EMAIL"], "" => [422, "INVALID_EMAIL"], "#{'a' * 250}@example.com" => [422, "INVALID_EMAIL"]
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
    assert_equal 0, SignInCode.count
    assert_equal 0, AuditLog.where(action: "admin.account.email_requested").count
    post "/api/admin/account/email/request", params: { email: %w[a b] }, headers: bearer(@token), as: :json
    assert_response :unprocessable_content
  end

  test "requests are limited to five an hour per admin" do
    Admin::AccountController::EMAIL_CHANGE_REQUESTS_PER_HOUR.times do |index|
      request_change("owner#{index}@example.com")
      assert_response :accepted
    end
    request_change("owner-late@example.com")
    assert_response :too_many_requests
    request_change("other@example.com", token: session_for(@other_admin))
    assert_response :accepted, "the limit is per admin"
  end

  test "wrong codes are limited per code and per admin, and a wrong code never changes anything" do
    # The failure budget uses fixed 15-minute windows; freeze the clock so a run that crosses a
    # window boundary does not reset the count halfway through.
    freeze_time
    token, code = change_for(@admin, "owner@example.com")
    wrong = code == "111111" ? "222222" : "111111"
    SignInCode::MAX_ATTEMPTS.times do
      confirm(token, wrong)
      assert_response :unprocessable_content
      assert_equal "OTP_INVALID", response.parsed_body["code"]
    end
    confirm(token, code)
    assert_response :unprocessable_content, "the right code no longer works once attempts are spent"
    assert_equal "admin@musilynk.local", @admin.reload.email
    assert_equal 3, @admin.sessions.count, "a failed change signs nobody out"

    Rails.cache.clear
    budget = Admin::AccountController::CONFIRM_FAILURES_PER_USER
    guesses = 0
    while guesses < budget
      token, code = change_for(@admin, "owner#{guesses}@example.com")
      wrong = code == "111111" ? "222222" : "111111"
      [SignInCode::MAX_ATTEMPTS, budget - guesses].min.times do
        confirm(token, wrong)
        guesses += 1
      end
    end
    token, code = change_for(@admin, "owner-final@example.com")
    confirm(token, code)
    assert_response :too_many_requests
  end

  test "a change token belongs to the admin who requested it and expires with the code" do
    token, code = change_for(@admin, "owner@example.com")
    confirm(token, code, token: session_for(@other_admin))
    assert_response :unprocessable_content, "another admin cannot finish someone else's change"
    assert_equal "EMAIL_CHANGE_EXPIRED", response.parsed_body["code"]
    assert_equal "second-admin@example.com", @other_admin.reload.email

    confirm(token.sub(/.\z/) { _1 == "a" ? "b" : "a" }, code)
    assert_equal "EMAIL_CHANGE_EXPIRED", response.parsed_body["code"]
    [nil, 12, ["x"], "x" * 5000].each do |bad|
      post "/api/admin/account/email/confirm", params: { changeToken: bad, code: }, headers: bearer(@token), as: :json
      assert_response :unprocessable_content
    end

    travel SignInCode::LIFETIME + 1.second do
      confirm(token, code)
      assert_response :unprocessable_content
      assert_equal "EMAIL_CHANGE_EXPIRED", response.parsed_body["code"]
    end
    assert_equal "admin@musilynk.local", @admin.reload.email
  end

  test "an address taken between the request and the code is refused at confirmation" do
    token, code = change_for(@admin, "owner@example.com")
    User.create!(name: "Fast Registrant", email: "owner@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    confirm(token, code)
    assert_response :conflict
    assert_equal "EMAIL_TAKEN", response.parsed_body["code"]
    assert_equal "admin@musilynk.local", @admin.reload.email
  end

  test "production without an email provider refuses to start a change instead of promising a code" do
    production = ActiveSupport::EnvironmentInquirer.new("production")
    with_env(NO_PROVIDER_ENV) { Rails.stub(:env, production) { request_change("owner@example.com") } }
    assert_response :service_unavailable
    assert_equal "EMAIL_DELIVERY_NOT_CONFIGURED", response.parsed_body["code"]
    assert_equal 0, SignInCode.count

    with_env(PROVIDER_ENV) { Rails.stub(:env, production) { request_change("owner@example.com") } }
    assert_response :accepted
    assert_nil response.parsed_body["debugCode"], "production never returns an on-screen code"
  end

  test "changing the password needs the current one, signs out other browsers and is audited" do
    change_password("wrong-password", "BrandNewPass456!")
    assert_response :forbidden
    assert_equal "PASSWORD_INCORRECT", response.parsed_body["code"]
    change_password(PASSWORD, "short")
    assert_response :unprocessable_content
    assert_equal "PASSWORD_TOO_SHORT", response.parsed_body["code"]
    change_password(PASSWORD, PASSWORD)
    assert_response :unprocessable_content
    assert_equal "PASSWORD_UNCHANGED", response.parsed_body["code"]
    post "/api/admin/account/password", params: { currentPassword: PASSWORD, newPassword: %w[a b] }, headers: bearer(@token), as: :json
    assert_response :unprocessable_content
    assert @admin.reload.authenticate(PASSWORD), "nothing changed yet"
    assert_equal 2, @admin.sessions.count

    @admin.email_tokens.create!(purpose: "reset_password", token_digest: Digest::SHA256.hexdigest("reset"), expires_at: 1.hour.from_now)
    change_password(PASSWORD, "BrandNewPass456!")
    assert_response :success
    assert_equal({ "ok" => true }, response.parsed_body)
    assert @admin.reload.authenticate("BrandNewPass456!")
    assert_equal 0, @admin.email_tokens.usable("reset_password").count, "an outstanding reset link stops working"
    audit = AuditLog.where(action: "admin.account.password_changed").sole
    assert_equal [@admin.id, @admin.id], [audit.actor_id, audit.entity_id]
    get "/api/me", headers: bearer(@token)
    assert_response :success
    get "/api/me", headers: bearer(@other_browser)
    assert_response :unauthorized

    post "/api/auth/login", params: { email: @admin.email, password: "BrandNewPass456!" }, as: :json
    assert_response :success, "the new password signs in (reserved address: second step skipped)"
  end

  test "wrong current passwords are limited per admin" do
    Admin::AccountController::PASSWORD_FAILURES_PER_USER.times do
      change_password("wrong-password", "BrandNewPass456!")
      assert_response :forbidden
    end
    change_password(PASSWORD, "BrandNewPass456!")
    assert_response :too_many_requests
    assert @admin.reload.authenticate(PASSWORD)
  end

  test "codes and tokens never reach the logs" do
    io = StringIO.new
    original = Rails.logger
    Rails.logger = ActiveSupport::Logger.new(io)
    token, code = change_for(@admin, "owner@example.com")
    confirm(token, code)
    assert_response :success
    Rails.logger = original
    assert_not_includes io.string, code
    assert_not_includes io.string, token
  ensure
    Rails.logger = original
  end

  test "the doctor and tester see the address after a change" do
    token, code = change_for(@admin, "owner@example.com")
    confirm(token, code)
    assert_response :success
    with_env(PROVIDER_ENV) { get "/api/admin/users/lookup", params: { email: "owner@example.com" }, headers: bearer(@token) }
    assert_response :success
    assert response.parsed_body["exists"]
    assert_nil response.parsed_body["diagnosis"].find { _1["code"] == "ADMIN_SECOND_FACTOR_SKIPPED" }, "a real address turns the second step back on"
  end

  private

  def request_change(email, token: @token)
    post "/api/admin/account/email/request", params: { email: }, headers: bearer(token), as: :json
  end

  def change_for(user, email)
    with_env(NO_PROVIDER_ENV) { request_change(email, token: session_for(user)) }
    assert_response :accepted
    [response.parsed_body.fetch("changeToken"), response.parsed_body.fetch("debugCode")]
  end

  def confirm(change_token, code, token: @token)
    post "/api/admin/account/email/confirm", params: { changeToken: change_token, code: }, headers: bearer(token), as: :json
  end

  def change_password(current, fresh, token: @token)
    post "/api/admin/account/password", params: { currentPassword: current, newPassword: fresh }, headers: bearer(token), as: :json
  end

  # Integration requests carry no User-Agent, so the session is bound to that same (empty) family.
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
