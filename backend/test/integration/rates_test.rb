require "test_helper"

class RatesTest < ActionDispatch::IntegrationTest
  setup do
    @seq = 0
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  def create_rated_talent(role_headline:, location:, session_rate:)
    @seq += 1
    user = User.create!(name: "Rates Person #{@seq}", email: "rates-#{@seq}-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "jobseeker", status: "active", profile_complete: true)
    user.create_profile!(headline: role_headline, location:, session_rate:, currency: "INR")
    user
  end

  test "unknown city returns 404" do
    get "/api/public/rates/not-a-city"
    assert_response :not_found
  end

  test "roles with fewer than five rated profiles show no data" do
    3.times { |i| create_rated_talent(role_headline: "drummer", location: "Chennai", session_rate: 3000 + i * 100) }

    get "/api/public/rates/chennai"
    assert_response :success
    drummer = response.parsed_body["roles"].find { _1["slug"] == "drummer" }
    assert_equal false, drummer["hasData"]
    assert_nil drummer["sessionRate"]
    assert_equal false, response.parsed_body["indexable"]
  end

  test "median and IQR computed once five or more rated profiles exist" do
    rates = [2000, 3000, 4000, 5000, 6000]
    rates.each { |rate| create_rated_talent(role_headline: "guitarist", location: "Kochi", session_rate: rate) }

    get "/api/public/rates/kochi"
    assert_response :success
    guitarist = response.parsed_body["roles"].find { _1["slug"] == "guitarist" }
    assert_equal true, guitarist["hasData"]
    assert_equal 5, guitarist["n"]
    assert_equal 4000, guitarist.dig("sessionRate", "median")
    assert_equal 3000, guitarist.dig("sessionRate", "p25")
    assert_equal 5000, guitarist.dig("sessionRate", "p75")
  end

  test "response is cached for an hour" do
    get "/api/public/rates/mumbai"
    assert_response :success
    assert_includes response.headers["Cache-Control"], "max-age=3600"
  end

  test "page is not indexable until at least three roles have data" do
    [2000, 3000, 4000, 5000, 6000].each { |rate| create_rated_talent(role_headline: "guitarist", location: "Lucknow", session_rate: rate) }
    get "/api/public/rates/lucknow"
    assert_equal false, response.parsed_body["indexable"]
  end
end
