require "test_helper"

# Tokenised AND/OR search, typo retry, partial matches, ranking, shared taxonomy and directory
# role groups (SRCH-01, 02, 03, 06, 07, 10).
class SearchDiscoveryTest < ActionDispatch::IntegrationTest
  setup do
    Search::Spelling.reset!
    @employer = User.create!(name: "Discovery Studio", email: "discovery-studio@example.com", password: "StrongPass123!", role: "employer", status: "active", profile_complete: true)
    @employer.create_profile!(company_name: "Discovery Studio")
  end

  teardown { Search::Spelling.reset! }

  test "every word must match, synonyms stand in for a word, and a city constrains location" do
    mumbai = job!("Guitarist for a wedding", location: "Mumbai")
    job!("Guitarist for a club night", location: "Bengaluru", description: "Play covers near Mumbai for a club night with a fast-moving setlist and rehearsals.")
    job!("Drummer for a wedding", location: "Mumbai")

    get "/api/jobs", params: { q: "guitar player bombay" }
    assert_equal [mumbai.id], ids("jobs"), "the city matches the location, not a description mention"
    assert_equal "all", response.parsed_body["matchMode"]
    assert_includes response.parsed_body["interpretedAs"], "guitarist"

    get "/api/search", params: { q: "guitarist mumbai" }
    assert_equal [mumbai.id], response.parsed_body["results"].select { _1["type"] == "jobs" }.pluck("id"), "global search keeps the location (SRCH-03)"
  end

  test "plural and case variants find the same rows" do
    singer = professional!("Asha", headline: "Vocalist · Bollywood", roles: ["Vocalist"])
    %w[singer SINGERS vocalists गायक gayak].each do |q|
      get "/api/public/talent", params: { q: }
      assert_includes ids("talent"), singer.id, q
    end
  end

  test "misspellings are corrected and reported as didYouMean" do
    violin = job!("Violinist for a string quartet")
    get "/api/jobs", params: { q: "voilinist" }
    assert_equal [violin.id], ids("jobs")
    assert_equal "corrected", response.parsed_body["matchMode"]
    assert_equal "violinist", response.parsed_body["didYouMean"]

    get "/api/search", params: { q: "voilinist" }
    assert_equal "violinist", response.parsed_body["didYouMean"]
    assert_equal [violin.id], response.parsed_body["results"].pluck("id")
  end

  test "a multi-word query with no full match falls back to partial matches, best first" do
    both = job!("Violinist for a Goa wedding", location: "Goa")
    one = job!("Violinist for a studio album", location: "Pune")
    job!("Drummer for a club", location: "Pune")
    get "/api/jobs", params: { q: "violinist goa sangeet reception" }
    assert_equal "partial", response.parsed_body["matchMode"]
    assert_equal [both.id, one.id], ids("jobs")
  end

  test "code-like input is inert and never partially matched" do
    job!("Drop-in tabla player for jobs fair")
    ["'; DROP TABLE jobs; --", "%", "' OR '1'='1"].each do |q|
      get "/api/jobs", params: { q: }
      assert_empty ids("jobs"), q
      assert_equal 0, response.parsed_body["total"]
    end
  end

  test "headline and title hits outrank bio mentions (SRCH-10)" do
    bio = professional!("Bio Mention", headline: "FOH Engineer · Live", roles: ["FOH Engineer"], bio: "Works fast with producers every week.")
    real = professional!("Real Producer", headline: "Music Producer · EDM", roles: ["Music Producer"])
    role = professional!("Second Role", headline: "Bassist · Jazz", roles: ["Bassist", "Music Producer"])
    get "/api/public/talent", params: { q: "producer" }
    assert_equal [real.id, role.id, bio.id], ids("talent")
  end

  test "acts are found by lineup role and member instrument" do
    owner = professional!("Owner")
    act = Act.create!(owner:, name: "Night Owls", act_type: "band", city: "Pune", currency: "INR", fee_basis: "event", status: "active")
    act.act_members.create!(display_name: "Lead", role_name: "Lead Vocalist", member_status: "confirmed")
    act.act_members.create!(display_name: "Keys", role_name: "Keys", instrument: "Harmonium", member_status: "confirmed")
    %w[singer harmonium vocalist].each do |q|
      get "/api/public/acts", params: { q: }
      assert_equal [act.id], ids("acts"), q
    end
    get "/api/search", params: { q: "vocalist" }
    assert_includes response.parsed_body["results"].select { _1["type"] == "acts" }.pluck("id"), act.id, "acts show in All (SRCH-04)"
  end

  test "the function filter accepts current and legacy names; taxonomy serves one list" do
    legacy = job!("Old production role", function_area: "Production")
    current = job!("New production role", function_area: "Music Production")
    job!("Performance role", function_area: "Performance")
    ["Music Production", "Production", "music production"].each do |function|
      get "/api/jobs", params: { function: }
      assert_equal [current.id, legacy.id].sort, ids("jobs").sort, function
    end

    get "/api/taxonomy"
    body = response.parsed_body
    assert_equal Search::Taxonomy.function_areas, body["functionAreas"]
    assert_equal "Music Production", body.dig("legacyFunctionAreas", "Production")
    assert_equal({ "key" => "performer", "label" => "Artists & performers" }, body["talentRoles"].first)
  end

  test "job alerts match legacy function names" do
    seeker = professional!("Alert Seeker")
    job = job!("Old production role", function_area: "Production")
    job.update!(published_at: 1.hour.ago)
    alert = seeker.job_alerts.create!(name: "Production", function_area: "Music Production", frequency: "daily", active: true)
    assert_equal [job.id], alert.matching_jobs(window_start: 1.day.ago, window_end: Time.current).pluck(:id)
  end

  test "every landing-page role tile lists professionals on seed data (SRCH-01)" do
    SyntheticQa::BatchSeeder.call(batch: "demo-tiles", jobseekers: 12, employers: 2, password: "SyntheticPass123!")
    Search::Taxonomy.talent_roles.each do |key, role|
      get "/api/public/talent", params: { role: key }
      assert_response :success
      assert_operator response.parsed_body["total"], :>=, 1, "#{role[:label]} (#{key}) is empty"
      assert_equal({ "key" => key, "label" => role[:label] }, response.parsed_body["role"])
    end
    get "/api/public/talent", params: { role: "Tabla Player" }
    assert_operator response.parsed_body["total"], :>=, 1, "a free-text role still works"
    assert_equal "Tabla Player", response.parsed_body.dig("role", "label")
    get "/api/public/talent", params: { location: "Bangalore" }
    assert_operator response.parsed_body["total"], :>=, 1, "city aliases work in the location filter"
  end

  test "the legacy function data migration is idempotent and leaves current names alone" do
    require Rails.root.join("db/migrate/20260928120000_map_legacy_job_function_areas").to_s
    old = job!("Touring role", function_area: "Touring")
    kept = job!("Performance role", function_area: "Performance")
    other = job!("Custom role", function_area: "Something custom")
    seeker = professional!("Alert Owner")
    alert = seeker.job_alerts.create!(name: "Live", function_area: "Live Sound", frequency: "daily", active: true)
    migration = MapLegacyJobFunctionAreas.new
    migration.verbose = false
    2.times { migration.up }
    assert_equal "Tour & Production Management", old.reload.function_area
    assert_equal "Performance", kept.reload.function_area
    assert_equal "Something custom", other.reload.function_area
    assert_equal "Live Sound & Audio", alert.reload.function_area
    migration.down
    assert_equal "Tour & Production Management", old.reload.function_area, "rollback keeps the current names"
  end

  test "global search results are cached briefly per query, type and viewer kind" do
    SearchController.cache_seconds = 60
    SearchController::RESULTS_CACHE.clear
    first = job!("Cached cellist")
    get "/api/search", params: { q: "cellist" }
    assert_equal [first.id], response.parsed_body["results"].pluck("id")
    job!("Second cellist")
    get "/api/search", params: { q: "  Cellist " }
    assert_equal [first.id], response.parsed_body["results"].pluck("id"), "the same normalised query is served from the cache"
    get "/api/search", params: { q: "cellist", type: "jobs" }
    assert_equal 2, response.parsed_body["total"], "another type is a different entry"
    viewer = User.create!(name: "QA Viewer", email: "qa-viewer-cache@example.invalid", password: "StrongPass123!", role: "jobseeker", status: "active",
      profile_complete: true, synthetic_batch: "local-qa")
    raw = SecureRandom.urlsafe_base64(48)
    viewer.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    get "/api/search", params: { q: "cellist" }, headers: { "Authorization" => "Bearer #{raw}" }
    assert_equal 2, response.parsed_body.dig("totals", "jobs"), "synthetic viewers never share the public entry"
  ensure
    SearchController.cache_seconds = 0
    SearchController::RESULTS_CACHE.clear
  end

  private

  def ids(key) = response.parsed_body.fetch(key).pluck("id")

  def job!(title, location: "Mumbai", function_area: nil, description: nil)
    Job.create!(employer: @employer, title:, company: "Discovery Studio", location:, kind: "Contract", genre: "Classical", function_area:,
      description: description || "#{title}. A paid engagement with rehearsals, written terms and on-site production support.", status: "published")
  end

  def professional!(name, headline: "Session player", roles: [], bio: nil)
    user = User.create!(name:, email: "#{name.parameterize}-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "jobseeker",
      status: "active", profile_complete: true)
    user.create_profile!(headline:, roles:, bio:, location: "Pune")
    user
  end
end
