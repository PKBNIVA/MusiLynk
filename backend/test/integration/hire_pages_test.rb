require "test_helper"

class HirePagesTest < ActionDispatch::IntegrationTest
  setup do
    @seq = 0
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  def create_talent(name:, headline:, location:, roles: [], verified: false)
    @seq += 1
    user = User.create!(name:, email: "hire-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!",
      role: "jobseeker", status: "active", profile_complete: true)
    user.create_profile!(headline:, location:, roles:, verified:)
    user
  end

  test "unknown role returns 404" do
    get "/api/public/hire-pages/not-a-role/mumbai"
    assert_response :not_found
  end

  test "unknown city returns 404" do
    get "/api/public/hire-pages/drummer/not-a-city"
    assert_response :not_found
  end

  test "counts and indexable threshold" do
    4.times { |i| create_talent(name: "Mumbai Drummer #{i}", headline: "Session drummer", location: "Mumbai, MH") }

    get "/api/public/hire-pages/drummer/mumbai"
    assert_response :success
    body = response.parsed_body
    assert_equal 4, body.dig("counts", "professionals")
    assert_equal false, body["indexable"]
    assert_equal "drummer", body.dig("role", "slug")
    assert_equal "Drummer", body.dig("role", "label")
    assert_equal "Mumbai", body.dig("city", "name")
    assert_kind_of Array, body["featured"]
    assert_kind_of Array, body["relatedRoles"]
    assert_equal 4, body["relatedRoles"].length
    assert_kind_of Array, body["nearbyCities"]
    assert_equal 3, body["nearbyCities"].length
    assert_kind_of Array, body["faq"]
    assert_equal 4, body["faq"].length

    create_talent(name: "Mumbai Drummer 5", headline: "Session drummer", location: "Mumbai, MH")
    Rails.cache.clear
    get "/api/public/hire-pages/drummer/mumbai"
    assert_equal 5, response.parsed_body.dig("counts", "professionals")
    assert_equal true, response.parsed_body["indexable"]
  end

  test "featured profiles never include private fields and prioritize verified" do
    create_talent(name: "Unverified Drummer", headline: "drummer", location: "Pune")
    verified = create_talent(name: "Verified Drummer", headline: "drummer", location: "Pune", verified: true)

    get "/api/public/hire-pages/drummer/pune"
    assert_response :success
    featured = response.parsed_body["featured"]
    assert_equal verified.id, featured.first["id"]
    assert_nil featured.first["email"]
  end

  test "response is cached for an hour" do
    get "/api/public/hire-pages/drummer/mumbai"
    assert_response :success
    assert_includes response.headers["Cache-Control"], "max-age=3600"
  end

  test "faq mentions rates page and falls back to a neutral rate sentence with no data" do
    get "/api/public/hire-pages/drummer/goa"
    assert_response :success
    faq = response.parsed_body["faq"]
    assert_match(/Rates vary by experience and event/, faq.first["answer"])
    assert_match(%r{/rates/goa}, faq.last["answer"])
  end

  test "popular searches lists mumbai combinations first" do
    5.times { |i| create_talent(name: "Mumbai Singer #{i}", headline: "singer", location: "Mumbai") }
    get "/api/public/hire-pages/popular-searches"
    assert_response :success
    items = response.parsed_body["items"]
    assert items.any? { |item| item.dig("city", "slug") == "mumbai" && item.dig("role", "slug") == "singer" }
    mumbai_index = items.index { |item| item.dig("city", "slug") == "mumbai" }
    other_index = items.index { |item| item.dig("city", "slug") != "mumbai" }
    assert(mumbai_index.nil? || other_index.nil? || mumbai_index < other_index)
  end

  test "professionals_in is the head count of counts_for, in one query" do
    3.times { |i| create_talent(name: "Count Drummer #{i}", headline: "drummer", location: "Pune", verified: i.zero?) }
    assert_equal 3, Seo::HireStats.professionals_in("Drummer", "Pune")
    assert_equal Seo::HireStats.counts_for("Drummer", "Pune")[:professionals], Seo::HireStats.professionals_in("Drummer", "Pune")
    queries = []
    callback = ->(*, payload) { queries << payload[:sql] unless payload[:name] == "SCHEMA" }
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { Seo::HireStats.professionals_in("Drummer", "Pune") }
    assert_equal 1, queries.length
  end
end
