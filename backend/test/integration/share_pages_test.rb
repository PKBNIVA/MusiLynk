require "test_helper"
require "nokogiri"

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
    assert_includes response.body, %(<meta property="og:image" content="#{FrontendUrl.base}/api/og/opportunity/#{job.id}.png">)
    assert_includes response.body, %(<meta name="twitter:image" content="#{FrontendUrl.base}/api/og/opportunity/#{job.id}.png">)
  end

  test "share pages redirect browsers by meta refresh but not Google's crawlers" do
    job = create_job("published")
    get "/share/opportunities/#{job.id}", headers: { "User-Agent" => "WhatsApp/2.23" }
    assert_includes response.body, %(http-equiv="refresh")
    assert_equal "User-Agent", response.headers["Vary"]
    [ "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Mozilla/5.0 (compatible; Google-InspectionTool/1.0)" ].each do |agent|
      get "/share/opportunities/#{job.id}", headers: { "User-Agent" => agent }
      assert_response :success
      refute_includes response.body, %(http-equiv="refresh")
      assert_includes response.body, "\"@type\":\"JobPosting\""
      assert_includes response.body, %(<link rel="canonical" href="#{FrontendUrl.base}/opportunities/#{job.id}">)
    end
  end

  test "draft job share page 404s" do
    job = create_job("draft")
    get "/share/opportunities/#{job.id}"
    assert_response :not_found
  end

  test "unknown job id returns default share html" do
    get "/share/opportunities/does-not-exist"
    assert_response :not_found
    assert_includes response.body, "MusiLynk"
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
    assert_includes response.body, %(<meta property="og:image" content="#{FrontendUrl.base}/api/og/professional/#{user.id}.png">)
  end

  test "act share page renders" do
    act = Act.create!(owner: @employer, name: "Share Act", act_type: "Band", currency: "INR", fee_basis: "flat", status: "active")
    get "/share/acts/#{act.id}"
    assert_response :success
    assert_includes response.body, "Share Act"
    assert_includes response.body, "\"@type\":\"MusicGroup\""
    assert_includes response.body, %(<meta property="og:image" content="#{FrontendUrl.base}/api/og/act/#{act.id}.png">)
  end

  test "an unknown id and the default page keep the static default image" do
    get "/share/professionals/does-not-exist"
    assert_response :not_found
    assert_includes response.body, %(<meta property="og:image" content="#{FrontendUrl.base}/og-default.png">)
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

  def job_ld(job)
    get "/share/opportunities/#{job.id}"
    assert_response :success
    JSON.parse(response.body[%r{<script type="application/ld\+json">(.*?)</script>}m, 1])
  end

  test "JobPosting carries every field Google requires and a valid baseSalary unit" do
    job = create_job("published")
    job.update_columns(compensation_min: 20_000, compensation_max: 40_000, compensation_period: "month", application_deadline: 10.days.from_now)
    ld = job_ld(job)
    %w[title description datePosted validThrough hiringOrganization jobLocation baseSalary].each { assert ld.key?(_1), "missing #{_1}" }
    assert_equal "Organization", ld["hiringOrganization"]["@type"]
    assert_equal "IN", ld["jobLocation"]["address"]["addressCountry"]
    assert_equal "MONTH", ld["baseSalary"]["value"]["unitText"]
    assert_equal 20_000, ld["baseSalary"]["value"]["minValue"]
    assert_nothing_raised { Time.iso8601(ld["datePosted"]) }
    assert_nothing_raised { Time.iso8601(ld["validThrough"]) }
  end

  test "baseSalary is omitted for per-session, per-show and per-project pay, which schema.org has no unit for" do
    %w[session show project].each do |period|
      job = create_job("published")
      job.update_columns(compensation_min: 5_000, compensation_max: 9_000, compensation_period: period)
      assert_not job_ld(job).key?("baseSalary"), "#{period} must not produce a baseSalary"
    end
    job = create_job("published")
    job.update_columns(compensation_min: 900, compensation_max: nil, compensation_period: "day")
    value = job_ld(job)["baseSalary"]["value"]
    assert_equal "DAY", value["unitText"]
    assert_not value.key?("maxValue"), "a missing maximum must be left out, not published as null"
  end

  test "a remote JobPosting declares who may apply, as Google requires with TELECOMMUTE" do
    job = create_job("published")
    job.update_columns(workplace: "remote")
    ld = job_ld(job)
    assert_equal "TELECOMMUTE", ld["jobLocationType"]
    assert_equal({ "@type" => "Country", "name" => "IN" }, ld["applicantLocationRequirements"])
    assert_not ld.key?("jobLocation")
  end

  test "a profile with no bio or headline still gets a non-empty meta description" do
    user = create_user("Share Bare Profile", "jobseeker")
    get "/share/professionals/#{user.id}"
    assert_response :success
    assert_no_match(/name="description" content=""/, response.body)
    assert_no_match(/og:description" content=""/, response.body)
  end

  test "an unknown id renders the default page as noindex so a 404 body is never indexed" do
    get "/share/acts/does-not-exist"
    assert_response :not_found
    assert_includes response.body, %(<meta name="robots" content="noindex">)
  end

  test "the share page body carries the title and description as text for crawlers that read the document" do
    job = create_job("published", description: "Evening house band for a hotel lounge, four nights a week, with a written contract and a stable rota.")
    get "/share/opportunities/#{job.id}", headers: { "User-Agent" => "Googlebot/2.1" }
    body = Nokogiri::HTML(response.body)
    assert_equal "#{job.title} at #{job.company} | MusiLynk", body.at_css("main h1").text
    assert_includes body.at_css("main p").text, "Evening house band for a hotel lounge"
  end
end
