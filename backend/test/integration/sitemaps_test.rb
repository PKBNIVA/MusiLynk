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
end
