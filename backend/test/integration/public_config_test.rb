require "test_helper"
require "minitest/mock"

# GET /api/public/config (PublicConfig): the business settings the frontend reads instead of its
# own constants, edge-cached for anonymous callers; and the per-user feature flags on GET /api/me.
class PublicConfigTest < ActionDispatch::IntegrationTest
  setup do
    @seq = 0
    @musician = create_user("Config Musician", "jobseeker")
    @employer = create_user("Config Employer", "employer")
  end

  test "anonymous: the body carries fees, plans, limits, catalogue and flags from the settings files, with no queries" do
    count = count_queries { get "/api/public/config" }
    assert_response :success
    assert_equal 0, count, "the config body is in-memory settings only"
    body = response.parsed_body
    assert_equal %w[catalog features fees generatedAt limits plans], body.keys.sort

    fees = body["fees"]
    assert_equal BookingFeePolicy.platform_fee_percent, fees["platformFeePercent"]
    assert_equal BookingFeePolicy.gst_percent, fees["gstPercent"]
    assert_equal({ "fullRefundDays" => 7, "partialRefundDays" => 2, "partialRefundPercent" => 50 }, fees["cancellation"])
    assert_equal BookingFeePolicy.plain_english, fees["plainEnglish"]

    plans = body["plans"]
    assert_equal PlanCatalog.codes, plans.map { _1["code"] }
    pro = plans.find { _1["code"] == "pro" }
    assert_equal({ "code" => "pro", "name" => "Pro", "monthly" => 2499, "annual" => 24990, "trialDays" => 14, "activePosts" => 10, "seats" => 2, "shortlist" => 250, "bookings" => 20 }, pro)

    assert_equal Limits.public_json.transform_keys(&:to_s), body["limits"]
    assert_equal 10, body["limits"]["maxLiveSessions"]
    assert_equal 8, body["limits"]["publicPortfolioItemsShown"]

    catalog = body["catalog"]
    assert_equal ["Mumbai"], catalog["launchCities"]
    assert_equal({ "slug" => "mumbai", "name" => "Mumbai" }, catalog["cities"].first)
    assert_equal Seo::Pages.role_slugs, catalog["hireRoles"].map { _1["slug"] }

    assert_equal({ "stage" => true, "resumes" => false }, body["features"])
    assert_in_delta Time.current, Time.iso8601(body["generatedAt"]), 5
  end

  test "anonymous responses are edge-cacheable per edge_cache.yml and answer a conditional GET with 304" do
    lifetime = EdgeCache.lifetime(:config)
    get "/api/public/config"
    control = response.headers["Cache-Control"].to_s
    assert_includes control, "public"
    assert_includes control, "s-maxage=#{lifetime.s_maxage}"
    assert_includes control, "stale-while-revalidate=#{lifetime.stale_while_revalidate}"
    assert_includes response.headers["Vary"].to_s.split(",").map(&:strip), "Authorization"
    etag = response.headers["ETag"]
    assert_match(/\AW\//, etag)
    get "/api/public/config", headers: { "If-None-Match" => etag }
    assert_response :not_modified
    assert_empty response.body
  end

  test "signed-in callers get the same anonymous body, marked private" do
    get "/api/public/config"
    anonymous = response.parsed_body.except("generatedAt")
    [@musician, @employer].each do |user|
      get "/api/public/config", headers: auth(user)
      assert_response :success
      assert_includes response.headers["Cache-Control"].to_s, "private"
      assert_not_includes response.headers["Cache-Control"].to_s, "s-maxage"
      assert_equal anonymous, response.parsed_body.except("generatedAt")
    end
  end

  test "only GET is routed" do
    post "/api/public/config"
    assert_response :not_found
  end

  test "a kill switch in env is reflected immediately" do
    with_env("FEATURE_STAGE", "false") do
      get "/api/public/config"
      assert_equal false, response.parsed_body.dig("features", "stage")
      get "/api/me", headers: auth(@musician)
      assert_equal false, response.parsed_body.dig("features", "stage")
    end
  end

  test "GET /api/me resolves every flag for the signed-in person, honouring the allowlist" do
    flags = { stage: { enabled: true, percentage: 100, allowlist: [] }, resumes: { enabled: true, percentage: 0, allowlist: [@musician.id] } }
    Features.stub(:definitions, flags) do
      get "/api/me", headers: auth(@musician)
      assert_response :success
      assert_equal({ "stage" => true, "resumes" => true }, response.parsed_body["features"], "allow-listed by id")

      get "/api/me", headers: auth(@employer)
      assert_equal({ "stage" => true, "resumes" => false }, response.parsed_body["features"], "not allow-listed, 0% rollout")

      get "/api/public/config"
      assert_equal({ "stage" => true, "resumes" => false }, response.parsed_body["features"], "anonymous never sees a partial rollout")
    end
  end

  test "GET /api/me without a session is 401 and carries no flags" do
    get "/api/me"
    assert_response :unauthorized
    assert_nil response.parsed_body["features"]
  end

  private

  def with_env(key, value)
    previous = ENV[key]
    ENV[key] = value
    yield
  ensure
    previous.nil? ? ENV.delete(key) : ENV[key] = previous
  end

  def count_queries
    count = 0
    callback = ->(*, payload) { count += 1 unless %w[SCHEMA TRANSACTION].include?(payload[:name]) || payload[:sql].match?(/\A(BEGIN|COMMIT|SAVEPOINT|RELEASE)/) }
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { yield }
    count
  end

  def create_user(name, role)
    @seq += 1
    User.create!(name:, email: "cfg-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active",
      profile_complete: true, email_verified: true).tap { _1.create_profile!({}) }
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
