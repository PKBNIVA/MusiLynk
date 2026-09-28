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
    # The limit counts in fixed one-minute windows; freeze the clock so a slow run can't cross one.
    freeze_time
    SearchController::REQUESTS_PER_MINUTE.times do
      get "/api/search", params: { q: "drummer" }
      assert_response :success
    end
    get "/api/search", params: { q: "drummer" }
    assert_response :too_many_requests

    get "/api/search", params: { q: "drummer" }, env: { "REMOTE_ADDR" => "203.0.113.9" }
    assert_response :success, "another IP keeps its own budget"
  end

  test "all results keep a share for every type instead of filling up with jobs and talent" do
    employer = User.create!(name: "Rhythm Studio", email: "rhythm-studio@example.com", password: "StrongPass123!", role: "employer", status: "active", profile_complete: true)
    35.times do |index|
      Job.create!(employer:, title: "Zephyr drummer #{index}", company: "Rhythm Studio", location: "Mumbai", kind: "Contract", genre: "Rock",
        description: "Record drums for a studio album with written terms and agreed compensation for every session.", status: "published")
      talent = User.create!(name: "Zephyr Talent #{index}", email: "zephyr-#{index}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", profile_complete: true)
      talent.create_profile!(headline: "Zephyr session player")
    end
    Act.create!(owner: employer, name: "Zephyr Band", act_type: "band", currency: "INR", fee_basis: "event", status: "active")

    get "/api/search", params: { q: "Zephyr" }
    results = response.parsed_body["results"]
    assert_equal SearchController::MAX_RESULTS, results.size
    counts = results.pluck("type").tally
    assert_equal 1, counts["acts"], "acts are not pushed out by jobs and talent"
    assert_operator counts["jobs"], :>=, 15
    assert_operator counts["talent"], :>=, 15
    assert_equal results.pluck("type").chunk_while { _1 == _2 }.map(&:first), %w[jobs talent acts], "results stay grouped by type"
  end
end
