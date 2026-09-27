require "test_helper"

class SearchLimitsTest < ActionDispatch::IntegrationTest
  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  test "queries longer than the limit are cut before searching" do
    get "/api/search", params: { q: "a" * 500 }
    assert_response :success
    assert_equal ["a" * SearchController::MAX_QUERY_LENGTH], response.parsed_body["interpretedAs"]

    singer = User.create!(name: "Asha Rao", email: "asha-limit@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", profile_complete: true)
    singer.create_profile!(headline: "Playback singer", location: "Mumbai")
    get "/api/search", params: { q: "singer#{' ' * 200}#{'x' * 200}", type: "talent" }
    assert_response :success
    assert_includes response.parsed_body["results"].pluck("title"), "Asha Rao", "trailing whitespace left by the cut is trimmed"
  end

  test "each IP gets a bounded number of searches per minute" do
    SearchController::REQUESTS_PER_MINUTE.times do
      get "/api/search", params: { q: "drummer" }
      assert_response :success
    end
    get "/api/search", params: { q: "drummer" }
    assert_response :too_many_requests

    get "/api/search", params: { q: "drummer" }, env: { "REMOTE_ADDR" => "203.0.113.9" }
    assert_response :success, "another IP keeps its own budget"
  end
end
