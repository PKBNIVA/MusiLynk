require "test_helper"

# Sessions expire when idle, slide forward while used, never pass a hard cap, and
# notice a token replayed from a different browser.
class SessionLifetimeTest < ActionDispatch::IntegrationTest
  PASSWORD = "StrongPass123!".freeze
  CHROME_129 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36".freeze
  CHROME_131 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36".freeze
  CURL = "curl/8.5.0".freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @user = User.create!(name: "Idle User", email: "idle@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    @admin = User.create!(name: "Idle Admin", email: "idle-admin@example.com", password: PASSWORD, role: "admin", status: "active")
  end

  teardown do
    Rails.cache = @original_cache
  end

  test "a new session records its client and uses the idle timeout under a hard cap" do
    freeze_time do
      token = sign_in(@user, CHROME_129)
      session = @user.sessions.sole
      assert_equal Session::IDLE_TIMEOUT.from_now, session.expires_at
      assert_equal Session::LIFETIME.from_now, session.absolute_expires_at
      assert_equal Session.fingerprint(CHROME_129), session.client_fingerprint
      assert_not_includes session.client_fingerprint, "chrome"
      me(token, CHROME_129)
      assert_response :success
    end
  end

  test "an unused session expires after the idle timeout" do
    token = sign_in(@user, CHROME_129)
    travel Session::IDLE_TIMEOUT + 1.minute do
      me(token, CHROME_129)
      assert_response :unauthorized
    end
  end

  test "use slides expiry forward, at most every few minutes, and never past the hard cap" do
    token = sign_in(@user, CHROME_129)
    session = @user.sessions.sole
    created = session.expires_at

    travel 1.minute do
      me(token, CHROME_129)
      assert_equal created, session.reload.expires_at, "no write inside the renewal window"
    end
    travel 6.days do
      me(token, CHROME_129)
      assert_response :success
      assert_in_delta Session::IDLE_TIMEOUT.from_now, session.reload.expires_at, 1.second
    end
    travel 12.days do
      me(token, CHROME_129)
      assert_response :success, "still in use, so still signed in after the first idle window"
    end
    travel 18.days do
      me(token, CHROME_129)
      assert_response :success
    end
    travel 24.days do
      me(token, CHROME_129)
      assert_response :success
      assert_equal session.reload.absolute_expires_at, session.expires_at, "renewal is capped"
    end
    travel Session::LIFETIME + 1.minute do
      me(token, CHROME_129)
      assert_response :unauthorized
    end
  end

  test "admin sessions have a shorter idle timeout and hard cap" do
    token = admin_session(@admin, CHROME_129)
    session = @admin.sessions.sole
    assert_in_delta Session::ADMIN_LIFETIME.from_now, session.absolute_expires_at, 5.seconds
    assert_in_delta Session::ADMIN_IDLE_TIMEOUT.from_now, session.expires_at, 5.seconds
    travel Session::ADMIN_IDLE_TIMEOUT + 1.minute do
      get "/api/admin/stats", headers: headers(token, CHROME_129)
      assert_response :unauthorized
    end
  end

  test "browser updates keep the session; a different browser is flagged once for a member" do
    token = sign_in(@user, CHROME_129)
    me(token, CHROME_131)
    assert_response :success
    assert_nil @user.sessions.sole.flagged_at
    assert_not AuditLog.exists?(action: "auth.session_client_mismatch")

    2.times do
      me(token, CURL, ip: "203.0.113.44")
      assert_response :success, "members are never signed out by a fingerprint change"
    end
    assert @user.sessions.sole.flagged_at
    events = AuditLog.where(action: "auth.session_client_mismatch", entity_id: @user.id)
    assert_equal 1, events.count
    assert_equal "203.0.113.44", events.sole.metadata["ip"]
  end

  test "an admin token replayed from a different browser is revoked" do
    token = admin_session(@admin, CHROME_129)
    get "/api/admin/stats", headers: headers(token, CHROME_131)
    assert_response :success

    get "/api/admin/stats", headers: headers(token, CURL)
    assert_response :unauthorized
    assert_equal 0, @admin.sessions.count
    assert AuditLog.exists?(action: "auth.session_revoked", entity_id: @admin.id)

    get "/api/admin/stats", headers: headers(token, CHROME_129)
    assert_response :unauthorized, "a revoked token stays dead for the original browser too"
  end

  test "sessions from before this change keep their fixed expiry and adopt the first client they see" do
    raw = SecureRandom.urlsafe_base64(48)
    legacy = @user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 10.days.from_now)
    legacy.update_columns(created_at: 20.days.ago)
    me(raw, CHROME_129)
    assert_response :success
    legacy.reload
    assert_equal Session.fingerprint(CHROME_129), legacy.client_fingerprint
    assert_in_delta 10.days.from_now, legacy.expires_at, 5.seconds
    me(raw, CURL)
    assert legacy.reload.flagged_at, "binding applies from the first use"
  end

  test "an admin session from before the second sign-in step is cut to the admin lifetime" do
    raw = SecureRandom.urlsafe_base64(48)
    legacy = @admin.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 25.days.from_now)
    legacy.update_columns(created_at: 5.days.ago)
    get "/api/admin/stats", headers: headers(raw, CHROME_129)
    assert_response :success
    assert_in_delta 2.days.from_now, legacy.reload.expires_at, 5.seconds

    old = @admin.sessions.create!(token_digest: Digest::SHA256.hexdigest("old-#{raw}"), expires_at: 20.days.from_now)
    old.update_columns(created_at: 10.days.ago)
    get "/api/admin/stats", headers: headers("old-#{raw}", CHROME_129)
    assert_response :unauthorized, "an admin session older than the admin lifetime ends on its next use"
  end

  private

  def sign_in(user, agent)
    post "/api/auth/login", params: { email: user.email, password: PASSWORD }, headers: { "User-Agent" => agent }, as: :json
    assert_response :success
    response.parsed_body.fetch("accessToken")
  end

  def admin_session(user, agent)
    post "/api/auth/login", params: { email: user.email, password: PASSWORD }, headers: { "User-Agent" => agent }, as: :json
    assert_response :accepted
    challenge = response.parsed_body
    post "/api/auth/second-factor", params: { challengeToken: challenge.fetch("challengeToken"), code: challenge.fetch("debugCode") },
      headers: { "User-Agent" => agent }, as: :json
    assert_response :success
    response.parsed_body.fetch("accessToken")
  end

  def me(token, agent, ip: "127.0.0.1")
    get "/api/me", headers: headers(token, agent), env: { "REMOTE_ADDR" => ip }
  end

  def headers(token, agent) = { "Authorization" => "Bearer #{token}", "User-Agent" => agent }
end
