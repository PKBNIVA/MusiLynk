require "test_helper"
require "nokogiri"

class SitemapsTest < ActionDispatch::IntegrationTest
  setup do
    @seq = 0
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @employer = create_user("Sitemap Employer", "employer")
  end

  teardown { Rails.cache = @original_cache }

  def create_user(name, role)
    @seq += 1
    User.create!(name:, email: "sitemap-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active",
      profile_complete: true).tap { _1.create_profile! }
  end

  def create_job(status)
    Job.create!(employer: @employer, title: "Sitemap job", company: "Sitemap Employer", location: "Pune", kind: "Contract", genre: "Rock",
      description: "A properly documented professional opportunity with clear responsibilities and written terms for the session.",
      status:, published_at: status == "published" ? Time.current : nil)
  end

  test "sitemap.xml has correct content type and is well-formed" do
    get "/sitemap.xml"
    assert_response :success
    assert_equal "application/xml", response.media_type
    doc = Nokogiri::XML(response.body) { |config| config.strict }
    assert_empty doc.errors
  end

  test "static pages are present" do
    get "/sitemap.xml"
    %w[/ /music-jobs /music-professionals /book-music /urgent /join/hiring /join/musician /pricing /guide /about /safety /contact /community-guidelines /terms /privacy].each do |path|
      assert_match %r{<loc>[^<]*#{Regexp.escape(path)}</loc>}, response.body, "missing #{path}"
    end
  end

  test "published job present, draft and closed jobs absent" do
    published = create_job("published")
    draft = create_job("draft")
    closed = create_job("closed")

    get "/sitemap.xml"
    assert_match "/opportunities/#{published.id}", response.body
    assert_no_match(/opportunities\/#{draft.id}</, response.body)
    assert_no_match(/opportunities\/#{closed.id}</, response.body)
  end

  test "incomplete profile is absent from talent listing" do
    incomplete = User.create!(name: "Incomplete Person", email: "sitemap-incomplete-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "jobseeker", status: "active", profile_complete: false).tap { _1.create_profile! }
    discoverable = create_user("Discoverable Person", "jobseeker")

    get "/sitemap.xml"
    assert_match "/professionals/#{discoverable.id}", response.body
    assert_no_match(/professionals\/#{incomplete.id}</, response.body)
  end

  test "a role x city hire page is only in the sitemap once it has enough real profiles" do
    get "/sitemap.xml"
    assert_no_match(%r{/hire/drummer/goa<}, response.body)

    5.times { |i| create_user("Goa Drummer #{i}", "jobseeker") }
    Profile.where(user_id: User.where("name LIKE 'Goa Drummer%'").select(:user_id))
      .update_all(headline: "Session drummer", location: "Goa")
    Rails.cache.clear

    get "/sitemap.xml"
    assert_match "/hire/drummer/goa", response.body
  end

  test "the mumbai rates page is only in the sitemap once enough roles have rate data" do
    get "/sitemap.xml"
    assert_no_match(%r{/rates/mumbai<}, response.body)
  end

  test "demo and hidden synthetic accounts are never in the sitemap, with their jobs and acts" do
    real = create_user("Sitemap Real Musician", "jobseeker")
    demo = create_user("Sitemap Demo Musician", "jobseeker")
    qa = create_user("Sitemap Qa Musician", "jobseeker")
    demo.update!(synthetic_batch: "demo-20260926-1200")
    qa.update!(synthetic_batch: "local-qa")
    demo_employer = create_user("Sitemap Demo Employer", "employer")
    demo_employer.update!(synthetic_batch: "demo-20260926-1200")
    real_job = create_job("published")
    demo_job = Job.create!(employer: demo_employer, title: "Demo job", company: "Demo Co", location: "Pune", kind: "Contract", genre: "Rock",
      description: "A properly documented professional opportunity with clear responsibilities and written terms for the session.",
      status: "published", published_at: Time.current)
    act_attrs = { act_type: "band", currency: "INR", fee_basis: "event", status: "active" }
    real_act = Act.create!(owner: real, name: "Real Act", **act_attrs)
    demo_act = Act.create!(owner: demo, name: "Demo Act", **act_attrs)

    get "/sitemap.xml"
    assert_match "/professionals/#{real.id}", response.body
    assert_match "/opportunities/#{real_job.id}", response.body
    assert_match "/acts/#{real_act.id}", response.body
    [demo.id, qa.id, demo_job.id, demo_act.id].each { assert_no_match(/#{_1}</, response.body) }
  end

  test "portfolios owned by synthetic accounts are not in the sitemap" do
    real = create_user("Sitemap Portfolio Real", "jobseeker")
    demo = create_user("Sitemap Portfolio Demo", "jobseeker")
    demo.update!(synthetic_batch: "demo-20260926-1200")
    real_portfolio = Portfolio.create!(owner_type: "user", owner_id: real.id, title: "Real", slug: "sm-real-#{SecureRandom.hex(4)}", visibility: "public")
    demo_portfolio = Portfolio.create!(owner_type: "user", owner_id: demo.id, title: "Demo", slug: "sm-demo-#{SecureRandom.hex(4)}", visibility: "public")

    get "/sitemap.xml"
    assert_includes response.body, "/p/#{real_portfolio.slug}<"
    assert_not_includes response.body, "/p/#{demo_portfolio.slug}<"
  end

  test "a job whose application deadline has passed is not in the sitemap, and every record URL has a lastmod" do
    open_job = create_job("published")
    expired = create_job("published")
    expired.update_columns(application_deadline: 2.days.ago)
    dated = create_job("published")
    dated.update_columns(application_deadline: 5.days.from_now)

    get "/sitemap.xml"
    assert_match "/opportunities/#{open_job.id}", response.body
    assert_match "/opportunities/#{dated.id}", response.body
    assert_no_match(/opportunities\/#{expired.id}</, response.body)

    doc = Nokogiri::XML(response.body)
    doc.remove_namespaces!
    doc.xpath("//url").each do |url|
      loc = url.at_xpath("loc").text
      next unless loc.match?(%r{/(opportunities|professionals|acts)/})
      assert_match(/\A\d{4}-\d{2}-\d{2}\z/, url.at_xpath("lastmod")&.text.to_s, "#{loc} has no lastmod")
    end
  end

  test "the sitemap lists no URL twice" do
    create_job("published")
    create_user("Sitemap Unique Person", "jobseeker")
    get "/sitemap.xml"
    locs = Nokogiri::XML(response.body).remove_namespaces!.xpath("//loc").map(&:text)
    assert_equal locs.uniq, locs
  end
end
