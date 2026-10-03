require "test_helper"

# PublicCaching: anonymous GETs of the public read endpoints carry shared-cache headers
# (`public, s-maxage, stale-while-revalidate` from config/edge_cache.yml), a weak ETag that answers
# a conditional GET with 304, and `Vary: Authorization`. The same URLs answered for a signed-in
# person stay private (their body carries saved/applied flags, applause and QA visibility).
class EdgeCachingTest < ActionDispatch::IntegrationTest
  setup do
    @seq = 0
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @musician = create_user("Edge Musician", "jobseeker", { headline: "Drummer", location: "Mumbai" })
    @employer = create_user("Edge Employer", "employer")
    @act = Act.create!(owner: @musician, name: "Edge Act", act_type: "band", status: "active", currency: "INR", fee_basis: "event")
    @job = Job.create!(employer: @employer, title: "Edge gig", company: "Edge Co", location: "Pune", kind: "Gig", genre: "Rock",
      description: "A properly documented professional opportunity with clear responsibilities and written terms for the session.",
      status: "published", published_at: Time.current)
    Post.create!(author_type: "system", author_id: Post::SYSTEM_AUTHOR_ID, kind: "system", system_kind: "welcome", body: "Verified this week: 12 musicians")
  end

  teardown { Rails.cache = @original_cache }

  # path => the lifetime kind in config/edge_cache.yml
  def endpoints
    {
      "/api/public/stats" => :stats,
      "/api/public/talent?location=Mumbai&limit=6" => :listing,
      "/api/public/talent/#{@musician.id}" => :show,
      "/api/public/acts" => :listing,
      "/api/public/acts/#{@act.id}" => :show,
      "/api/jobs" => :listing,
      "/api/jobs/#{@job.id}" => :show,
      "/api/stage/authors/system/musilynk/posts" => :stage_posts,
      "/sitemap.xml" => :sitemap
    }
  end

  test "every public read endpoint tells the edge how long to keep an anonymous response" do
    endpoints.each do |path, kind|
      lifetime = EdgeCache.lifetime(kind)
      get path
      assert_response :success, path
      control = response.headers["Cache-Control"].to_s
      assert_includes control, "public", path
      assert_includes control, "s-maxage=#{lifetime.s_maxage}", path
      assert_includes control, "stale-while-revalidate=#{lifetime.stale_while_revalidate}", path
      assert_not_includes control, "private", path
      lifetime.max_age ? assert_includes(control, "max-age=#{lifetime.max_age}", path) : assert_not_includes(control, "max-age", path)
      assert_match(/\AW\/"[0-9a-f]+"\z/, response.headers["ETag"].to_s, "#{path} ETag")
      assert_includes response.headers["Vary"].to_s.split(",").map(&:strip), "Authorization", "#{path} Vary"
    end
  end

  test "a conditional GET with the current ETag is answered 304 without a body" do
    endpoints.each_key do |path|
      get path
      assert_response :success, path
      etag = response.headers["ETag"]
      body = response.body
      get path, headers: { "If-None-Match" => etag }
      assert_response :not_modified, path
      assert_empty response.body, path
      assert_equal etag, response.headers["ETag"], path
      assert_includes response.headers["Cache-Control"].to_s, "s-maxage", "#{path} 304 keeps the edge lifetime"

      # A different cached copy is not fresh: the full body comes back.
      get path, headers: { "If-None-Match" => 'W/"stale"' }
      assert_response :success, path
      assert_equal body, response.body, path
    end
  end

  test "the ETag changes when the data does" do
    get "/api/public/acts/#{@act.id}"
    before = response.headers["ETag"]
    @act.update!(tagline: "Now with horns")
    get "/api/public/acts/#{@act.id}"
    assert_not_equal before, response.headers["ETag"]
  end

  test "signed-in responses are private and never carry an edge lifetime" do
    [@musician, @employer].each do |user|
      endpoints.each_key do |path|
        next if path == "/sitemap.xml" # outside the API: no sessions, always anonymous
        get path, headers: auth(user)
        assert_response :success, "#{path} as #{user.role}"
        control = response.headers["Cache-Control"].to_s
        assert_includes control, "private", "#{path} as #{user.role}"
        assert_not_includes control, "s-maxage", "#{path} as #{user.role}"
        assert_not_includes control, "public", "#{path} as #{user.role}"
        assert_includes response.headers["Vary"].to_s.split(",").map(&:strip), "Authorization", "#{path} as #{user.role}"
      end
    end
  end

  test "a signed-in body is not served from an anonymous cache entry: the body differs and the response says so" do
    get "/api/jobs/#{@job.id}"
    anonymous = response.parsed_body
    SavedJob.create!(user: @musician, job: @job)
    get "/api/jobs/#{@job.id}", headers: auth(@musician)
    assert_equal true, response.parsed_body.dig("job", "saved")
    assert_not_equal true, anonymous.dig("job", "saved") # anonymous: nil (nobody to have saved it)
    assert_includes response.headers["Cache-Control"], "private"
  end

  test "an expired or unknown bearer token is treated as anonymous and gets the public lifetime" do
    get "/api/public/acts", headers: { "Authorization" => "Bearer not-a-session" }
    assert_response :success
    assert_includes response.headers["Cache-Control"], "s-maxage"
  end

  test "a bad request is never marked cacheable" do
    get "/api/public/talent?limit[]=1"
    assert_response :bad_request
    assert_not_includes response.headers["Cache-Control"].to_s, "s-maxage"
    get "/api/public/acts/missing-id"
    assert_response :not_found
    assert_not_includes response.headers["Cache-Control"].to_s, "s-maxage"
  end

  test "the conditional GET costs no more queries than the full one" do
    endpoints.each_key do |path|
      next if path == "/api/public/stats" || path == "/sitemap.xml" # Rails.cache-backed: 0 queries either way
      full = count_queries { get path }
      etag = response.headers["ETag"]
      conditional = count_queries { get path, headers: { "If-None-Match" => etag } }
      assert_response :not_modified
      assert_operator conditional, :<=, full, "#{path}: 304 ran #{conditional} queries, the 200 ran #{full}"
    end
  end

  test "every lifetime kind in the config is complete and the controllers only use known kinds" do
    EdgeCache.kinds.each do |kind|
      lifetime = EdgeCache.lifetime(kind)
      assert_operator lifetime.s_maxage, :>, 0, kind
      assert_operator lifetime.stale_while_revalidate, :>=, 0, kind
    end
    used = Dir[Rails.root.join("app/controllers/**/*.rb")].flat_map { File.read(_1).scan(/public_cache!\(:(\w+)/).flatten }.uniq.map(&:to_sym)
    assert_empty used - EdgeCache.kinds, "unknown lifetime kinds used by controllers"
    assert_empty EdgeCache.kinds - used, "lifetimes configured but unused"
  end

  private

  def count_queries
    count = 0
    callback = ->(*, payload) { count += 1 unless %w[SCHEMA TRANSACTION].include?(payload[:name]) || payload[:sql].match?(/\A(BEGIN|COMMIT|SAVEPOINT|RELEASE)/) }
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { yield }
    count
  end

  def create_user(name, role, profile = {})
    @seq += 1
    User.create!(name:, email: "edge-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active",
      profile_complete: true, email_verified: true).tap { _1.create_profile!(profile) }
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
