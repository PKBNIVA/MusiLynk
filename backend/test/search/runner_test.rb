require "test_helper"
require "minitest/mock"

# Search::Runner: typo tolerance only when too few rows match, capped totals while browsing, and a
# cancelled statement degrading to an empty result instead of a 500.
class SearchRunnerTest < ActionDispatch::IntegrationTest
  setup { Search::Spelling.reset! }
  teardown { Search::Spelling.reset! }

  test "a word that matches only a few rows also searches its correction, with the exact match first" do
    exact = person("Exact Match", headline: "Guitarst collective")
    fixed = 3.times.map { person("Fixed #{_1}", headline: "Guitarist") }
    get "/api/public/talent", params: { q: "guitarst" }
    body = response.parsed_body
    assert_equal exact.id, body["talent"].first["id"], "what was typed still ranks first"
    assert_equal [exact.id, *fixed.map(&:id)].sort, body["talent"].pluck("id").sort
    assert_equal "all", body["matchMode"], "something matched as typed, so this is not a correction notice"
    assert_equal "guitarist", body["didYouMean"]

    get "/api/public/talent", params: { q: "guitarist" }
    assert_not_includes response.parsed_body["talent"].pluck("id"), exact.id, "a known word is never widened"
  end

  test "enough exact matches leave the query alone" do
    Search::Settings.stub(:typo_min_results, 1) do
      person("Only One", headline: "Guitarst")
      person("Other", headline: "Guitarist")
      get "/api/public/talent", params: { q: "guitarst" }
      assert_equal ["Only One"], response.parsed_body["talent"].pluck("name")
      assert_nil response.parsed_body["didYouMean"]
    end
  end

  test "a misspelt name with no vocabulary correction is found by trigram word similarity" do
    ananya = person("Ananya Desai", headline: "Guitar teacher")
    person("Someone Else", headline: "Guitar teacher")
    get "/api/public/talent", params: { q: "ananya desaai" }
    assert_equal [ananya.id], response.parsed_body["talent"].pluck("id")
    assert_equal "corrected", response.parsed_body["matchMode"], "nothing matched as typed"
    assert_nil response.parsed_body["didYouMean"], "no vocabulary term to offer"
  end

  test "browsing counts exactly up to the cap and estimates past it" do
    4.times { person("Browse #{_1}") }
    get "/api/public/talent", params: { limit: 1 }
    assert_equal 4, response.parsed_body["total"]
    Search::Settings.stub(:count_cap, 2) do
      get "/api/public/talent", params: { limit: 1 }
      assert_operator response.parsed_body["total"], :>=, 2, "an estimate never undercuts the cap"
      assert response.parsed_body["nextCursor"].present?
    end
  end

  test "thousands of rows tied on the score page the same way as a few" do
    people = 4.times.map { person("Tied #{_1}", headline: "Guitarist") }
    get "/api/public/talent", params: { q: "guitarist", limit: 2 }
    listed = response.parsed_body["talent"].pluck("id")
    Search::Runner.stub(:max_keys, 1) do
      get "/api/public/talent", params: { q: "guitarist", limit: 2 }
    end
    assert_equal listed, response.parsed_body["talent"].pluck("id"), "candidates as a subquery rank the same"
    assert_equal 4, response.parsed_body["total"]
    assert_equal people.map(&:id).sort, (listed + Search::Runner.call(User.discoverable_talent.joins(:profile), "guitarist", Search::Targets::TALENT,
      order: TalentController::LIST_ORDER, offset: 2, limit: 2).rows.map(&:id)).sort
  end

  test "a statement that runs out of time returns an empty page, not an error" do
    person("Slow Match", headline: "Guitarst")
    raises = ->(*) { raise ActiveRecord::QueryCanceled, "canceling statement due to statement timeout" }
    Search::Spelling.stub(:widen, raises) do
      get "/api/search", params: { q: "guitarst" }
    end
    assert_response :success
    assert_equal [], response.parsed_body["results"]
    assert_equal 0, response.parsed_body.dig("totals", "talent")
  end

  private

  def person(name, headline: "Session player")
    user = User.create!(name:, email: "#{name.parameterize}-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "jobseeker",
      status: "active", profile_complete: true)
    user.create_profile!(headline:, location: "Pune")
    user
  end
end
