require "test_helper"
require "minitest/mock"

# Admin password sign-in is two steps: the password answers with a short-lived
# challenge, and a code emailed to the admin completes it.
class AdminSecondFactorTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  PASSWORD = "StrongPass123!".freeze
  PROVIDER_ENV = { "EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send", "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil }.freeze
  NO_PROVIDER_ENV = { "EMAIL_DELIVERY_WEBHOOK" => nil, "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil }.freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @admin = User.create!(name: "Two Step Admin", email: "two-step@example.com", password: PASSWORD, role: "admin", status: "active")
    @member = User.create!(name: "Plain Member", email: "member@example.com", password: PASSWORD, role: "employer", status: "active")
  end

  teardown do
    Rails.cache = @original_cache
  end

  test "an admin password gives a challenge, not a session, and the emailed code completes it" do
    challenge = with_env(PROVIDER_ENV) do
      assert_enqueued_jobs 1, only: EmailDeliveryJob do
        password_login(@admin.email)
      end
      assert_response :accepted
      response.parsed_body
    end
    assert_equal true, challenge["secondFactorRequired"]
    assert_equal "email_code", challenge["method"]
    assert_equal 600, challenge["expiresIn"]
    assert_nil challenge["accessToken"]
    assert_nil challenge["user"]
    assert_nil challenge["debugCode"], "a configured provider never gets an on-screen code"
    assert_equal 0, @admin.sessions.count
    assert_nil @admin.reload.last_login_at

    job = enqueued_jobs.find { _1[:job] == EmailDeliveryJob }
    user_id, template, sealed = ActiveJob::Arguments.deserialize(job[:args])
    assert_equal [@admin.id, "sign_in_code"], [user_id, template]
    code = EmailDeliveryJob.unseal(sealed)
    assert_not_includes challenge["challengeToken"], code

    complete(challenge["challengeToken"], code)
    assert_response :success
    assert_equal %w[accessToken user], response.parsed_body.keys.sort
    assert_equal @admin.id, response.parsed_body.dig("user", "id")
    assert @admin.reload.last_login_at
    assert_equal({ "method" => "password", "secondFactor" => "email_code" }, AuditLog.where(action: "auth.login").last.metadata)

    get "/api/admin/stats", headers: bearer(response.parsed_body["accessToken"])
    assert_response :success

    complete(challenge["challengeToken"], code)
    assert_response :unauthorized, "the code is single-use"
  end

  test "non-admin password sign-in and admin email-code sign-in are unchanged" do
    with_env(NO_PROVIDER_ENV) { password_login(@member.email) }
    assert_response :success
    assert response.parsed_body["accessToken"]
    with_env(PROVIDER_ENV) { password_login(@member.email) }
    assert_response :success
    assert response.parsed_body["accessToken"]

    with_env(NO_PROVIDER_ENV) { post "/api/auth/otp/request", params: { email: @admin.email }, as: :json }
    code = response.parsed_body.fetch("debugCode")
    post "/api/auth/otp/verify", params: { email: @admin.email, code: }, as: :json
    assert_response :success
    assert response.parsed_body["accessToken"], "an emailed code already proves inbox control"
  end

  test "wrong codes, a forged or expired challenge, and a wrong password all fail" do
    password_login(@admin.email, "wrong-password")
    assert_response :unauthorized
    assert_nil response.parsed_body["challengeToken"]

    token, code = challenge_for(@admin)
    complete(token, code == "000000" ? "111111" : "000000")
    assert_response :unauthorized
    assert_equal "OTP_INVALID", response.parsed_body["code"]

    complete(token.sub(/.\z/) { _1 == "a" ? "b" : "a" }, code)
    assert_response :unauthorized
    assert_equal "SECOND_FACTOR_EXPIRED", response.parsed_body["code"]

    travel SignInCode::LIFETIME + 1.second do
      complete(token, code)
      assert_response :unauthorized
      assert_equal "SECOND_FACTOR_EXPIRED", response.parsed_body["code"]
    end
    assert_equal 0, @admin.sessions.count
  end

  test "a challenge for one admin cannot be completed with a code sent to another address" do
    token, _code = challenge_for(@admin)
    with_env(NO_PROVIDER_ENV) { post "/api/auth/otp/request", params: { email: @member.email }, as: :json }
    other_code = response.parsed_body.fetch("debugCode")
    complete(token, other_code)
    assert_response :unauthorized
    assert_equal 0, @admin.sessions.count
  end

  test "the code is locked after five wrong guesses and a newer challenge replaces an older one" do
    token, code = challenge_for(@admin)
    wrong = code == "111111" ? "222222" : "111111"
    SignInCode::MAX_ATTEMPTS.times { complete(token, wrong) }
    complete(token, code)
    assert_response :unauthorized, "the right code no longer works once attempts are spent"

    old_token, old_code = challenge_for(@admin)
    new_token, new_code = challenge_for(@admin)
    complete(old_token, old_code)
    assert_response :unauthorized
    complete(new_token, new_code)
    assert_response :success
  end

  test "challenges and wrong guesses are throttled" do
    AuthController::SECOND_FACTOR_CHALLENGES_PER_EMAIL.times do
      password_login(@admin.email)
      assert_response :accepted
    end
    password_login(@admin.email)
    assert_response :too_many_requests

    Rails.cache.clear
    budget = AuthController::SECOND_FACTOR_FAILURES_PER_USER
    guesses = 0
    while guesses < budget
      token, code = challenge_for(@admin, ip: "198.51.100.#{guesses}")
      wrong = code == "111111" ? "222222" : "111111"
      [SignInCode::MAX_ATTEMPTS, budget - guesses].min.times do
        complete(token, wrong, ip: "203.0.113.#{guesses}")
        guesses += 1
      end
    end
    token, code = challenge_for(@admin, ip: "198.51.100.200")
    complete(token, code, ip: "203.0.113.250")
    assert_response :too_many_requests, "per-admin failure budget applies across addresses"
  end

  test "garbage challenge tokens fail from one address until the IP budget runs out" do
    AuthController::SECOND_FACTOR_FAILURES_PER_IP.times { complete("forged", "123456", ip: "192.0.2.50") }
    complete("forged", "123456", ip: "192.0.2.50")
    assert_response :too_many_requests
    [nil, 12, ["x"], "x" * 5000].each do |token|
      post "/api/auth/second-factor", params: { challengeToken: token, code: "123456" }, env: { "REMOTE_ADDR" => "192.0.2.51" }, as: :json
      assert_response :unauthorized
    end
  end

  test "production without an email provider fails closed for admins only" do
    production = ActiveSupport::EnvironmentInquirer.new("production")
    with_env(NO_PROVIDER_ENV.merge("ADMIN_SECOND_FACTOR" => nil)) do
      Rails.stub(:env, production) { password_login(@admin.email) }
      assert_response :service_unavailable
      assert_equal "SECOND_FACTOR_UNAVAILABLE", response.parsed_body["code"]
      assert_nil response.parsed_body["accessToken"]
      assert_equal 0, @admin.sessions.count

      Rails.stub(:env, production) { password_login(@member.email) }
      assert_response :success
    end
  end

  test "ADMIN_SECOND_FACTOR=off is an explicit escape hatch and is audited" do
    with_env("ADMIN_SECOND_FACTOR" => "off") { password_login(@admin.email) }
    assert_response :success
    assert response.parsed_body["accessToken"]
    assert_equal({ "secondFactor" => "disabled" }, AuditLog.where(action: "auth.login").last.metadata)

    with_env("ADMIN_SECOND_FACTOR" => "false") { password_login(@admin.email) }
    assert_response :accepted, "only the exact value off disables the second step"
  end

  test "production never returns an on-screen code" do
    production = ActiveSupport::EnvironmentInquirer.new("production")
    with_env(PROVIDER_ENV) do
      Rails.stub(:env, production) { password_login(@admin.email) }
    end
    assert_response :accepted
    assert_nil response.parsed_body["debugCode"]
  end

  test "a suspended admin cannot complete a challenge issued before suspension" do
    token, code = challenge_for(@admin)
    @admin.update!(status: "suspended")
    complete(token, code)
    assert_response :forbidden
    assert_equal 0, @admin.sessions.count
  end

  private

  def password_login(email, password = PASSWORD, ip: "127.0.0.1")
    post "/api/auth/login", params: { email:, password: }, env: { "REMOTE_ADDR" => ip }, as: :json
  end

  def challenge_for(user, ip: "127.0.0.1")
    with_env(NO_PROVIDER_ENV) { password_login(user.email, ip:) }
    assert_response :accepted
    [response.parsed_body.fetch("challengeToken"), response.parsed_body.fetch("debugCode")]
  end

  def complete(token, code, ip: "127.0.0.1")
    post "/api/auth/second-factor", params: { challengeToken: token, code: }, env: { "REMOTE_ADDR" => ip }, as: :json
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
