require "test_helper"

class SharePagesTest < ActionDispatch::IntegrationTest
  setup do
    @seq = 0
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @employer = create_user("Share Employer", "employer")
  end

  teardown { Rails.cache = @original_cache }

  def create_user(name, role)
    @seq += 1
    User.create!(name:, email: "share-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active",
      profile_complete: true).tap { _1.create_profile! }
  end

  def create_job(status, description: "A properly documented professional opportunity with clear responsibilities and written terms.")
    Job.create!(employer: @employer, title: "Share job", company: "Share Employer", location: "Pune", kind: "Contract", genre: "Rock",
      description:, status:, published_at: status == "published" ? Time.current : nil)
  end

  test "job share page renders og tags and JobPosting JSON-LD" do
    job = create_job("published")
    get "/share/opportunities/#{job.id}"
    assert_response :success
    assert_includes response.body, "og:title"
    assert_includes response.body, job.title
    assert_includes response.body, "\"@type\":\"JobPosting\""
    assert_includes response.body, "<link rel=\"canonical\""
  end

  test "draft job share page 404s" do
    job = create_job("draft")
    get "/share/opportunities/#{job.id}"
    assert_response :not_found
  end

  test "unknown job id returns default share html" do
    get "/share/opportunities/does-not-exist"
    assert_response :not_found
    assert_includes response.body, "Verse"
  end

  test "script tags in job description are escaped in meta and JSON-LD" do
    job = create_job("published", description: "Great gig <script>alert(1)</script> apply now with clear terms and rehearsal schedule.")
    get "/share/opportunities/#{job.id}"
    assert_response :success
    assert_no_match(%r{<script>alert\(1\)</script>}, response.body)
    assert_no_match(%r{</script>alert}, response.body)
  end

  test "professional share page renders" do
    user = create_user("Share Professional", "jobseeker")
    user.update!(profile_complete: true)
    get "/share/professionals/#{user.id}"
    assert_response :success
    assert_includes response.body, user.name
    assert_includes response.body, "\"@type\":\"Person\""
  end

  test "act share page renders" do
    act = Act.create!(owner: @employer, name: "Share Act", act_type: "Band", currency: "INR", fee_basis: "flat", status: "active")
    get "/share/acts/#{act.id}"
    assert_response :success
    assert_includes response.body, "Share Act"
    assert_includes response.body, "\"@type\":\"MusicGroup\""
  end

  test "portfolio share page renders" do
    portfolio = Portfolio.create!(owner_type: "user", owner_id: @employer.id, title: "Share Portfolio", slug: "share-portfolio-#{SecureRandom.hex(4)}", visibility: "public")
    get "/share/p/#{portfolio.slug}"
    assert_response :success
    assert_includes response.body, "Share Portfolio"
    assert_includes response.body, "\"@type\":\"ProfilePage\""
  end

  test "portfolio share page 404s for a synthetic owner and renders for an organic one" do
    demo = create_user("Share Portfolio Demo", "jobseeker")
    demo.update!(synthetic_batch: "demo-20260926-1200")
    real = create_user("Share Portfolio Real", "jobseeker")
    attrs = ->(user, title) { { owner_type: "user", owner_id: user.id, title:, slug: "share-#{SecureRandom.hex(6)}", visibility: "public" } }
    demo_portfolio = Portfolio.create!(**attrs.call(demo, "Demo Portfolio"))
    real_portfolio = Portfolio.create!(**attrs.call(real, "Real Portfolio"))

    get "/share/p/#{real_portfolio.slug}"
    assert_response :success
    get "/share/p/#{demo_portfolio.slug}"
    assert_response :not_found
  end

  test "share pages 404 for demo and hidden synthetic accounts and their jobs and acts" do
    demo = create_user("Share Demo Musician", "jobseeker")
    demo.update!(synthetic_batch: "demo-20260926-1200")
    qa = create_user("Share Qa Musician", "jobseeker")
    qa.update!(synthetic_batch: "local-qa")
    real = create_user("Share Real Musician", "jobseeker")
    demo_employer = create_user("Share Demo Employer", "employer")
    demo_employer.update!(synthetic_batch: "demo-20260926-1200")
    demo_job = Job.create!(employer: demo_employer, title: "Demo share job", company: "Demo Co", location: "Pune", kind: "Contract", genre: "Rock",
      description: "A properly documented professional opportunity with clear responsibilities and written terms.", status: "published", published_at: Time.current)
    act_attrs = { act_type: "band", currency: "INR", fee_basis: "event", status: "active" }
    demo_act = Act.create!(owner: demo, name: "Demo Share Act", **act_attrs)
    real_act = Act.create!(owner: real, name: "Real Share Act", **act_attrs)

    get "/share/professionals/#{real.id}"
    assert_response :success
    get "/share/acts/#{real_act.id}"
    assert_response :success
    get "/share/professionals/#{demo.id}"
    assert_response :not_found
    get "/share/professionals/#{qa.id}"
    assert_response :not_found
    get "/share/acts/#{demo_act.id}"
    assert_response :not_found
    get "/share/opportunities/#{demo_job.id}"
    assert_response :not_found
  end
end
