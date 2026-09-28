require "test_helper"
require "minitest/mock"

# With ADMIN_ORIGIN set, the admin API and admin sign-in answer only the admin site's exact
# Origin; everyone else and every other endpoint behave exactly as before.
class AdminOriginTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  PASSWORD = "StrongPass123!".freeze
  ADMIN_SITE = "https://verse-admin-abcd.vercel.app".freeze
  PUBLIC_SITE = "http://localhost:5173".freeze
  LOCKED = { "ADMIN_ORIGIN" => ADMIN_SITE }.freeze
  NO_PROVIDER_ENV = { "EMAIL_DELIVERY_WEBHOOK" => nil, "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil }.freeze
  PROVIDER_ENV = { "EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send", "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil }.freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @admin = User.create!(name: "Site Admin", email: "site-admin@example.com", password: PASSWORD, role: "admin", status: "active")
    @member = User.create!(name: "Plain Member", email: "member@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    @member.create_profile!
    @token = session_for(@admin)
  end

  teardown do
    Rails.cache = @original_cache
  end

  test "admin endpoints refuse a missing or public origin and accept the admin origin, before looking at the token" do
    with_env(LOCKED) do
      get "/api/admin/stats", headers: bearer(@token)
      assert_response :forbidden
      assert_equal({ "error" => "The admin API only answers the admin site.", "code" => "ADMIN_ORIGIN_REQUIRED" }, response.parsed_body)

      [PUBLIC_SITE, "https://verse-admin-abcd.vercel.app.evil.example", "https://verse-admin-abcd.vercel.app/", "HTTPS://VERSE-ADMIN-ABCD.VERCEL.APP", "null"].each do |origin|
        get "/api/admin/stats", headers: bearer(@token).merge("Origin" => origin)
        assert_response :forbidden, origin
        assert_equal "ADMIN_ORIGIN_REQUIRED", response.parsed_body["code"]
      end

      get "/api/admin/stats", headers: { "Origin" => PUBLIC_SITE }
      assert_response :forbidden, "the origin is checked before authentication, so nothing is learned about the token"
      get "/api/admin/stats", headers: { "Origin" => ADMIN_SITE }
      assert_response :unauthorized

      get "/api/admin/stats", headers: bearer(@token).merge("Origin" => ADMIN_SITE)
      assert_response :success
      get "/api/admin/account", headers: bearer(@token).merge("Origin" => ADMIN_SITE)
      assert_response :success
      assert_equal true, response.parsed_body["adminOrigin"]
      post "/api/admin/account/password", params: { currentPassword: "nope", newPassword: "LongEnough123!" }, headers: bearer(@token).merge("Origin" => PUBLIC_SITE), as: :json
      assert_response :forbidden
      assert_equal "ADMIN_ORIGIN_REQUIRED", response.parsed_body["code"]
    end
  end

  test "a trailing slash in ADMIN_ORIGIN is tolerated, and an empty value means unlocked" do
    with_env("ADMIN_ORIGIN" => "#{ADMIN_SITE}/") do
      get "/api/admin/stats", headers: bearer(@token).merge("Origin" => ADMIN_SITE)
      assert_response :success
      get "/api/admin/stats", headers: bearer(@token)
      assert_response :forbidden
    end
    with_env("ADMIN_ORIGIN" => "   ") do
      get "/api/admin/stats", headers: bearer(@token)
      assert_response :success
    end
  end

  test "an admin password sign-in from the public site is refused after the password check, and audited" do
    with_env(LOCKED.merge(NO_PROVIDER_ENV)) do
      assert_no_enqueued_jobs do
        login(@admin.email, origin: PUBLIC_SITE)
      end
      assert_response :forbidden
      assert_equal({ "error" => "Admins sign in at the admin site.", "code" => "ADMIN_USE_ADMIN_SITE" }, response.parsed_body)
      assert_equal 0, SignInCode.count, "no code is issued for a sign-in that cannot complete"
      audit = AuditLog.where(action: "auth.admin_wrong_origin").sole
      assert_equal [@admin.id, PUBLIC_SITE], [audit.entity_id, audit.metadata["origin"]]

      login(@admin.email, origin: nil)
      assert_response :forbidden
      assert_equal "ADMIN_USE_ADMIN_SITE", response.parsed_body["code"]

      login(@admin.email, "wrong-password", origin: PUBLIC_SITE)
      assert_response :unauthorized, "a wrong password answers as for anyone else"
      assert_equal "Incorrect email or password.", response.parsed_body["error"]

      login(@admin.email, origin: ADMIN_SITE)
      assert_response :accepted
      token, code = response.parsed_body.values_at("challengeToken", "debugCode")

      post "/api/auth/second-factor", params: { challengeToken: token, code: }, headers: { "Origin" => PUBLIC_SITE }, as: :json
      assert_response :forbidden, "the second step cannot be finished on the public site"
      assert_equal "ADMIN_USE_ADMIN_SITE", response.parsed_body["code"]
      post "/api/auth/second-factor", params: { challengeToken: token, code: }, headers: { "Origin" => ADMIN_SITE }, as: :json
      assert_response :success, "the code was not spent by the refused attempt"
      assert response.parsed_body["accessToken"]
      origins = AuditLog.where(action: "auth.admin_wrong_origin", entity_id: @admin.id).order(:created_at).map { _1.metadata["origin"] }
      assert_equal [PUBLIC_SITE, "", PUBLIC_SITE], origins, "the password step twice and the second step once"
    end
  end

  test "ADMIN_SECOND_FACTOR=off still needs the admin site when the lock is on" do
    with_env(LOCKED.merge("ADMIN_SECOND_FACTOR" => "off")) do
      login(@admin.email, origin: PUBLIC_SITE)
      assert_response :forbidden
      assert_equal "ADMIN_USE_ADMIN_SITE", response.parsed_body["code"]
      login(@admin.email, origin: ADMIN_SITE)
      assert_response :success
      assert response.parsed_body["accessToken"]
    end
  end

  test "non-admins sign in from either origin exactly as before, and nothing changes without ADMIN_ORIGIN" do
    with_env(LOCKED) do
      login(@member.email, origin: PUBLIC_SITE)
      assert_response :success
      assert response.parsed_body["accessToken"]
      login(@member.email, origin: ADMIN_SITE)
      assert_response :success
      login(@member.email, origin: nil)
      assert_response :success
      get "/api/me", headers: bearer(response.parsed_body["accessToken"]).merge("Origin" => PUBLIC_SITE)
      assert_response :success
      get "/api/jobs", headers: { "Origin" => PUBLIC_SITE }
      assert_response :success
    end
    with_env("ADMIN_ORIGIN" => nil) do
      login(@admin.email, origin: PUBLIC_SITE)
      assert_response :accepted, "unlocked: the admin signs in from anywhere, with the second step"
      login(@admin.email, origin: nil)
      assert_response :accepted
      get "/api/admin/stats", headers: bearer(@token)
      assert_response :success
      get "/api/admin/stats", headers: bearer(@token).merge("Origin" => "https://evil.example")
      assert_response :success, "without ADMIN_ORIGIN the API relies on CORS alone, as today"
    end
    assert_equal 0, AuditLog.where(action: "auth.admin_wrong_origin").count
  end

  test "an admin address never gets or accepts an email-only code while locked, with no visible difference" do
    with_env(LOCKED.merge(PROVIDER_ENV)) do
      bodies = [@admin.email, @member.email, "nobody@example.com"].map do |email|
        assert_enqueued_jobs(email == @member.email ? 1 : 0, only: EmailDeliveryJob) do
          post "/api/auth/otp/request", params: { email: }, env: { "REMOTE_ADDR" => "192.0.2.#{email.length}" }, as: :json
        end
        assert_response :success
        response.parsed_body
      end
      assert_equal 1, bodies.uniq.size, "the answer is the same for an admin, a member and an unknown address"
      assert SignInCode.where(email: @admin.email).sole.used_at, "the admin's code is unusable from the start"

      # Sign-up details for an admin address must not turn into a usable sign-up code either.
      assert_no_enqueued_jobs(only: EmailDeliveryJob) do
        post "/api/auth/otp/request", params: { email: @admin.email, name: "Someone", role: "jobseeker" }, env: { "REMOTE_ADDR" => "192.0.2.50" }, as: :json
      end
      assert_response :success
    end

    with_env(LOCKED.merge(NO_PROVIDER_ENV)) do
      post "/api/auth/otp/request", params: { email: @admin.email }, env: { "REMOTE_ADDR" => "192.0.2.60" }, as: :json
      code = response.parsed_body.fetch("debugCode")
      post "/api/auth/otp/verify", params: { email: @admin.email, code: }, as: :json
      assert_response :unauthorized
      assert_equal "OTP_INVALID", response.parsed_body["code"]
      assert_equal 1, @admin.sessions.count, "only the session from setup exists"
    end

    # A code issued before the lock (or by any other path) is refused at verification too.
    with_env("ADMIN_ORIGIN" => nil) do
      with_env(NO_PROVIDER_ENV) { post "/api/auth/otp/request", params: { email: @admin.email }, env: { "REMOTE_ADDR" => "192.0.2.61" }, as: :json }
      @pre_lock_code = response.parsed_body.fetch("debugCode")
    end
    with_env(LOCKED) do
      post "/api/auth/otp/verify", params: { email: @admin.email, code: @pre_lock_code }, as: :json
      assert_response :unauthorized
      assert_equal "OTP_INVALID", response.parsed_body["code"]
    end
    with_env("ADMIN_ORIGIN" => nil) do
      with_env(NO_PROVIDER_ENV) { post "/api/auth/otp/request", params: { email: @admin.email }, env: { "REMOTE_ADDR" => "192.0.2.62" }, as: :json }
      post "/api/auth/otp/verify", params: { email: @admin.email, code: response.parsed_body.fetch("debugCode") }, as: :json
      assert_response :success, "unlocked, an admin's emailed code still signs in as before"
    end
  end

  test "readiness and the tester report the lock" do
    production = ActiveSupport::EnvironmentInquirer.new("production")
    with_env("ADMIN_ORIGIN" => nil) do
      checks = Rails.stub(:env, production) { ReadinessChecks.new.call }
      assert_equal({ ok: false, required: false, locked: false }, checks[:adminOrigin])
      assert_equal({ ok: true, required: false, locked: false }, ReadinessChecks.new.call[:adminOrigin], "outside production the lock is optional")
      get "/api/admin/tester", headers: bearer(@token)
      row = response.parsed_body["checks"].find { _1["name"] == "Admin site origin" }
      assert_equal [true, "medium"], [row["pass"], row["severity"]]
      assert_match "ADMIN_ORIGIN not set", row["detail"]
    end
    with_env(LOCKED) do
      checks = Rails.stub(:env, production) { ReadinessChecks.new.call }
      assert_equal({ ok: true, required: false, locked: true }, checks[:adminOrigin])
      get "/api/admin/tester", headers: bearer(@token).merge("Origin" => ADMIN_SITE)
      row = response.parsed_body["checks"].find { _1["name"] == "Admin site origin" }
      assert_equal true, row["pass"]
      assert_match "admin site only", row["detail"]
    end
  end

  private

  def login(email, password = PASSWORD, origin:)
    headers = origin ? { "Origin" => origin } : {}
    post "/api/auth/login", params: { email:, password: }, headers:, as: :json
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
