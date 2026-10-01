require "test_helper"

# The landing page's two-minute sign-up: link previews, register with work links (a starter
# portfolio), the hirer's organization Page, consent, the email-code path and public stats.
class TwoMinuteSignupTest < ActionDispatch::IntegrationTest
  PASSWORD = "Harbor-Lantern-4827!".freeze
  NO_PROVIDER_ENV = { "EMAIL_DELIVERY_WEBHOOK" => nil, "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil }.freeze
  YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ".freeze
  SOUNDCLOUD = "https://soundcloud.com/some-artist/live-at-blue-frog".freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @original_fetcher = LinkPreview.fetcher
    @fetched = []
    LinkPreview.fetcher = lambda do |uri|
      @fetched << uri.to_s
      if uri.host == "www.youtube.com"
        [200, { title: "<b>Tum Hi Ho</b> (live cover)", author_name: "Riya Sessions", thumbnail_url: "https://i.ytimg.com/vi/x/hqdefault.jpg",
                html: "<iframe src='https://evil.example'></iframe>" }.to_json]
      else
        [200, { title: "Live at Blue Frog", author_name: "Some Artist", thumbnail_url: "http://insecure.example/t.jpg" }.to_json]
      end
    end
  end

  teardown do
    LinkPreview.fetcher = @original_fetcher
    Rails.cache = @original_cache
  end

  # --- link previews -------------------------------------------------------------------------

  test "a YouTube link previews through oEmbed with only clean title, author and thumbnail" do
    post "/api/link-previews", params: { url: YOUTUBE }, as: :json
    assert_response :success
    body = response.parsed_body
    assert_equal({ "provider" => "youtube", "kind" => "video", "label" => "YouTube", "url" => YOUTUBE, "title" => "Tum Hi Ho (live cover)",
                   "author" => "Riya Sessions", "thumbnail" => "https://i.ytimg.com/vi/x/hqdefault.jpg" }, body)
    assert_not_includes response.body, "iframe"
    assert_equal 1, @fetched.size
    assert_match %r{\Ahttps://www\.youtube\.com/oembed\?url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json\z}, @fetched.first
  end

  test "previews are cached by URL for a day" do
    2.times { post "/api/link-previews", params: { url: YOUTUBE }, as: :json }
    assert_equal 1, @fetched.size
    travel 25.hours do
      post "/api/link-previews", params: { url: YOUTUBE }, as: :json
    end
    assert_equal 2, @fetched.size
  end

  test "SoundCloud drops an insecure thumbnail; Instagram, Spotify and other links are never fetched" do
    post "/api/link-previews", params: { url: SOUNDCLOUD }, as: :json
    assert_equal %w[soundcloud audio Live\ at\ Blue\ Frog], response.parsed_body.values_at("provider", "kind", "title")
    assert_nil response.parsed_body["thumbnail"]

    { "https://www.instagram.com/reel/abc/" => %w[instagram video Instagram], "https://open.spotify.com/track/123" => %w[spotify audio Spotify],
      "https://myband.in/epk" => %w[link link Link] }.each do |url, (provider, kind, label)|
      post "/api/link-previews", params: { url: }, as: :json
      assert_response :success
      assert_equal [provider, kind, label, url, nil], response.parsed_body.values_at("provider", "kind", "label", "url", "title")
    end
    assert_equal 1, @fetched.size
  end

  test "a failed or odd oEmbed answer still previews the link, uncached" do
    LinkPreview.fetcher = ->(_uri) { [404, "Not Found"] }
    post "/api/link-previews", params: { url: YOUTUBE }, as: :json
    assert_response :success
    assert_nil response.parsed_body["title"]
    LinkPreview.fetcher = ->(_uri) { raise Net::ReadTimeout }
    post "/api/link-previews", params: { url: YOUTUBE }, as: :json
    assert_response :success
    LinkPreview.fetcher = ->(_uri) { [200, "[1,2]"] }
    post "/api/link-previews", params: { url: YOUTUBE }, as: :json
    assert_nil response.parsed_body["title"]
    LinkPreview.fetcher = ->(_uri) { [200, { title: 42, thumbnail_url: "https://ok.example/#{'a' * 600}" }.to_json] }
    post "/api/link-previews", params: { url: YOUTUBE }, as: :json
    assert_equal [nil, nil], response.parsed_body.values_at("title", "thumbnail")
    assert_nil LinkPreview.cached(YOUTUBE).presence&.dig(:title)
  end

  test "link previews refuse unsafe input" do
    ["javascript:alert(1)", "http://youtube.com/watch?v=1", "https://user:pw@youtube.com/x", "", "https://#{'a' * 2_100}.com", "ht tp://x y"].each do |url|
      post "/api/link-previews", params: { url: }, as: :json
      assert_response :unprocessable_content, url
      assert_equal "INVALID_URL", response.parsed_body["code"]
    end
    post "/api/link-previews", params: { url: ["https://a.com"] }, as: :json
    assert_response :unprocessable_content
    assert_empty @fetched
  end

  test "link previews are rate-limited per IP" do
    LinkPreviewsController::PREVIEWS_PER_IP.times do
      post "/api/link-previews", params: { url: "https://myband.in/epk" }, env: { "REMOTE_ADDR" => "198.51.100.7" }, as: :json
    end
    assert_response :success
    post "/api/link-previews", params: { url: "https://myband.in/epk" }, env: { "REMOTE_ADDR" => "198.51.100.7" }, as: :json
    assert_response :too_many_requests
    post "/api/link-previews", params: { url: "https://myband.in/epk" }, env: { "REMOTE_ADDR" => "198.51.100.8" }, as: :json
    assert_response :success
  end

  # --- register --------------------------------------------------------------------------------

  test "a musician registers with roles, city, years and links and gets a starter portfolio" do
    post "/api/link-previews", params: { url: YOUTUBE }, as: :json
    register(role: "jobseeker", consent: true, roles: ["Session drummer", "Percussionist"], city: "Mumbai", yearsExperience: 8,
      headline: "Session drummer · Mumbai · 8 years", bio: "I play sessions and weddings in Mumbai.",
      links: [{ url: YOUTUBE }, { url: SOUNDCLOUD, title: "  <i>Blue Frog</i> set " }, { url: "https://open.spotify.com/track/9" }])
    assert_response :created
    body = response.parsed_body
    assert_equal({ "portfolioItems" => 3, "organizationId" => nil }, body["starter"])
    assert_equal true, body.dig("user", "profileComplete")
    assert_equal %w[Session\ drummer Percussionist], body.dig("user", "roles")
    assert_equal ["Mumbai", 8, "8 years", "Session drummer · Mumbai · 8 years", YOUTUBE],
      body["user"].values_at("location", "yearsExperience", "experience", "headline", "portfolioUrl")

    user = User.find_by!(email: body.dig("user", "email"))
    assert_in_delta Time.current, user.consented_at, 5.seconds
    items = user.portfolio_items.order(:sort_order)
    assert_equal ["Tum Hi Ho (live cover)", "Blue Frog set", "Spotify track"], items.map(&:title)
    assert_equal %w[video audio audio], items.map(&:kind)
    assert_equal ["https://i.ytimg.com/vi/x/hqdefault.jpg", nil, nil], items.map(&:thumbnail_url)
    assert_equal [true, false, false], items.map(&:featured)
    assert items.all? { _1.visibility == "public" && _1.credited_as == "Session drummer" }
    assert_equal({ "source" => "signup", "provider" => "youtube" }, items.first.media_metadata)
    assert_equal 1, @fetched.size, "register must not call oEmbed itself"

    get "/api/public/talent/#{user.id}"
    assert_response :success
    assert_equal 3, response.parsed_body["portfolio"].size
  end

  test "the old register payload still works and records no consent" do
    register(role: "jobseeker")
    assert_response :created
    body = response.parsed_body
    assert_equal({ "portfolioItems" => 0, "organizationId" => nil }, body["starter"])
    assert_equal false, body.dig("user", "profileComplete")
    assert_nil User.find_by!(email: body.dig("user", "email")).consented_at
  end

  test "register refuses a sign-up that declines consent, and creates nothing" do
    assert_no_difference -> { User.count } do
      register(role: "jobseeker", consent: false, roles: ["Singer"], city: "Mumbai")
    end
    assert_response :unprocessable_content
    assert_equal "CONSENT_REQUIRED", response.parsed_body["code"]
    assert response.parsed_body.dig("fields", "consent").present?
  end

  test "register validates the starter answers before creating the account" do
    assert_no_difference -> { User.count } do
      register(role: "jobseeker", consent: true, links: [{ url: "http://insecure.example" }] * 2 + [{ url: YOUTUBE }] * 4)
      assert_equal ["Add up to 5 links."], response.parsed_body.dig("fields", "links")
      register(role: "jobseeker", consent: true, links: ["javascript:alert(1)"], yearsExperience: 200, roles: ["x" * 61] + %w[a b c d e f g h])
      fields = response.parsed_body["fields"]
      assert_match(/Link 1/, fields["links"].first)
      assert_equal %w[links roles yearsExperience], fields.keys.sort
      assert_equal 2, fields["roles"].size
      register(role: "employer", consent: true, hirerKind: "mafia", companyName: "x" * 121, city: "y" * 121, links: [YOUTUBE])
      assert_equal %w[city companyName hirerKind links], response.parsed_body["fields"].keys.sort
      register(role: "jobseeker", consent: true, links: ["https://bucket.r2.dev/#{UploadStorage::KEY_PREFIX}/a.mp3"])
      assert_match(/uploaded files/, response.parsed_body.dig("fields", "links").first)
    end
    assert_response :unprocessable_content
  end

  test "a hirer with a company name gets an organization Page and a complete profile" do
    register(role: "employer", consent: "true", hirerKind: "event_company", city: "Mumbai", companyName: "Shaadi Beats Events")
    assert_response :created
    body = response.parsed_body
    org = Organization.find(body.dig("starter", "organizationId"))
    user = User.find_by!(email: body.dig("user", "email"))
    assert_equal ["Shaadi Beats Events", "event_company", "Mumbai", "active", user.id], [org.name, org.org_type, org.city, org.status, org.owner_id]
    assert_equal "owner", org.organization_members.find_by!(user:).role
    assert_equal ["Shaadi Beats Events", "Event and wedding company · Mumbai", true], body["user"].values_at("companyName", "headline", "profileComplete")
  end

  test "a hirer without a company name gets no Page and finishes the profile later" do
    register(role: "employer", consent: true, hirerKind: "band", city: "Pune")
    assert_response :created
    body = response.parsed_body
    assert_nil body.dig("starter", "organizationId")
    assert_equal ["Band or artist · Pune", false], body["user"].values_at("headline", "profileComplete")
    assert_equal 0, Organization.count
  end

  # --- email-code sign-up + starter --------------------------------------------------------------

  test "consent given with a sign-up code is recorded on the account the code creates" do
    code = request_code("coder-new@example.com", name: "Code Musician", role: "jobseeker", consent: true)
    post "/api/auth/otp/verify", params: { email: "coder-new@example.com", code: }, as: :json
    assert_response :success
    token = response.parsed_body["accessToken"]
    user = User.find_by!(email: "coder-new@example.com")
    assert user.consented_at

    post "/api/onboarding/starter", params: { roles: ["Guitarist"], city: "Mumbai", links: [YOUTUBE, SOUNDCLOUD] }, headers: auth(token), as: :json
    assert_response :success
    assert_equal({ "portfolioItems" => 2, "organizationId" => nil }, response.parsed_body["starter"])
    assert_equal true, response.parsed_body.dig("user", "profileComplete")
    # A retried request adds nothing twice.
    post "/api/onboarding/starter", params: { roles: ["Guitarist"], links: [YOUTUBE] }, headers: auth(token), as: :json
    assert_equal 0, response.parsed_body.dig("starter", "portfolioItems")
    assert_equal 2, user.portfolio_items.count
    assert_equal ["Guitarist"], user.profile.reload.roles
  end

  test "the starter accepts a drafted profile's genres, instruments, credits and item captions in one request" do
    code = request_code("drafted-new@example.com", name: "Drafted Musician", role: "jobseeker", consent: true)
    post "/api/auth/otp/verify", params: { email: "drafted-new@example.com", code: }, as: :json
    token = response.parsed_body["accessToken"]

    post "/api/onboarding/starter", params: {
      roles: ["Guitarist"], genres: ["Indie"], instruments: ["Acoustic Guitar"], credits: [{ text: "Toured with a famous band" }],
      links: [{ url: YOUTUBE, title: "Live session", caption: "Recorded live in Mumbai" }]
    }, headers: auth(token), as: :json

    assert_response :success
    user = User.find_by!(email: "drafted-new@example.com")
    assert_equal ["Indie"], user.profile.genres
    assert_equal ["Acoustic Guitar"], user.profile.instruments
    assert_equal ["Toured with a famous band"], user.profile.credits
    assert_equal "Recorded live in Mumbai", user.portfolio_items.first.description
  end

  test "a sign-up code request that declines consent is refused; sign-in codes never need it" do
    with_env(NO_PROVIDER_ENV) do
      post "/api/auth/otp/request", params: { email: "no-consent@example.com", name: "No Consent", role: "jobseeker", consent: false }, as: :json
      assert_response :unprocessable_content
      assert_equal "CONSENT_REQUIRED", response.parsed_body["code"]
    end
    code = request_code("old-client@example.com", name: "Old Client", role: "employer")
    post "/api/auth/otp/verify", params: { email: "old-client@example.com", code: }, as: :json
    assert_response :success
    assert_nil User.find_by!(email: "old-client@example.com").consented_at
  end

  test "the starter endpoint records consent once and validates like register" do
    register(role: "employer")
    token = response.parsed_body["accessToken"]
    user = User.find_by!(email: response.parsed_body.dig("user", "email"))
    post "/api/onboarding/starter", params: { consent: true, hirerKind: "studio", companyName: "Tape Room Studio", city: "Mumbai" }, headers: auth(token), as: :json
    assert_response :success
    first_consent = user.reload.consented_at
    assert first_consent
    assert response.parsed_body.dig("starter", "organizationId")
    travel 1.minute do
      post "/api/onboarding/starter", params: { consent: true, links: [YOUTUBE] }, headers: auth(token), as: :json
    end
    assert_response :unprocessable_content
    assert_equal first_consent, user.reload.consented_at

    post "/api/onboarding/starter", params: { roles: ["Singer"] }, as: :json
    assert_response :unauthorized
  end

  # --- public stats ------------------------------------------------------------------------------

  test "public stats count real, listed people and open work only, cached for five minutes" do
    musician = talent("Verified Drummer", "Mumbai, Maharashtra", verified: true)
    talent("Unverified Singer", "mumbai", verified: false)
    talent("Pune Violinist", "Pune", verified: true)
    talent("Demo Person", "Delhi", verified: true, synthetic_batch: "demo-20260928-0000")
    talent("QA Person", "Chennai", verified: true, synthetic_batch: "qa-batch-one")
    incomplete = talent("Half Done", "Goa", verified: true)
    incomplete.update!(profile_complete: false)
    Job.create!(employer: musician, company: "Sangeet Co", kind: "Gig", genre: "Folk", title: "Wedding sangeet dholi", description: "D" * 90, location: "Mumbai", status: "published")
    Job.create!(employer: musician, company: "Sangeet Co", kind: "Gig", genre: "Folk", title: "Draft", description: "D" * 90, location: "Mumbai", status: "draft")
    UrgentRequest.create!(requester: musician, title: "Drummer tonight", role_name: "Drummer", currency: "INR", city: "Mumbai", start_at: 1.day.from_now, end_at: 2.days.from_now, status: "open")

    get "/api/public/stats"
    assert_response :success
    assert_match(/max-age=300/, response.headers["Cache-Control"])
    body = response.parsed_body
    assert_equal [2, 3, 2, 1, 1], body.values_at("verifiedProfiles", "professionals", "cities", "openOpportunities", "urgentRequests")

    talent("Another", "Kolkata", verified: true)
    get "/api/public/stats"
    assert_equal 2, response.parsed_body["verifiedProfiles"], "cached"
    travel 6.minutes do
      get "/api/public/stats"
      assert_equal 3, response.parsed_body["verifiedProfiles"]
    end
  end

  private

  def register(role:, **extra)
    post "/api/auth/register", params: { name: "Riya Desai", email: "riya-#{SecureRandom.hex(4)}@example.com", password: PASSWORD, role:, **extra }, as: :json
  end

  def auth(token) = { "Authorization" => "Bearer #{token}" }

  def talent(name, location, verified:, synthetic_batch: nil)
    user = User.create!(name:, email: "#{name.parameterize}-#{SecureRandom.hex(3)}@example.com", password: PASSWORD, role: "jobseeker",
      status: "active", profile_complete: true, synthetic_batch:)
    user.create_profile!(location:, verified:)
    user
  end

  def request_code(email, **extra)
    with_env(NO_PROVIDER_ENV) { post "/api/auth/otp/request", params: { email:, **extra }, as: :json }
    assert_response :success
    response.parsed_body.fetch("debugCode")
  end

  def with_env(values)
    previous = values.keys.index_with { ENV[_1] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
