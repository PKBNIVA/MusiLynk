require "test_helper"

class AiPortfolioItemClassifierTest < ActiveSupport::TestCase
  test "parse strictly drops any role/genre/instrument outside the taxonomy and any unknown portfolio id" do
    portfolios = [{ id: "pf_1", name: "Live sets" }, { id: "pf_2", name: "Studio work" }]
    raw = {
      tags: ["mixing", "hindi pop"],
      roles: [Search::Taxonomy.talent_roles.values.first[:label], "Time Traveler"],
      genres: ["Not A Real Genre"],
      instruments: [CatalogController::INSTRUMENTS.first, "Theremin Deluxe 9000"],
      suggestedPortfolioIds: ["pf_1", "pf_unknown"],
      reasons: ["fits the live set catalog"]
    }.to_json

    result = AiPortfolioItemClassifier.parse(raw, portfolios: portfolios)

    assert_includes result[:roles], Search::Taxonomy.talent_roles.values.first[:label]
    assert_not_includes result[:roles], "Time Traveler"
    assert_equal [], result[:genres]
    assert_includes result[:instruments], CatalogController::INSTRUMENTS.first
    assert_not_includes result[:instruments], "Theremin Deluxe 9000"
    assert_equal ["pf_1"], result[:suggestedPortfolioIds]
    assert_equal ["mixing", "hindi pop"], result[:tags]
  end

  test "parse raises AI_MALFORMED_RESPONSE on invalid JSON or a non-object" do
    assert_raises(AiAssist::Error) { AiPortfolioItemClassifier.parse("not json", portfolios: []) }
    assert_raises(AiAssist::Error) { AiPortfolioItemClassifier.parse("[1,2,3]", portfolios: []) }
  end

  test ".call raises AI_DISABLED when AI assist is not configured" do
    with_env("ANTHROPIC_API_KEY" => nil) do
      error = assert_raises(AiAssist::Error) { AiPortfolioItemClassifier.call({ title: "x", tags: [] }, portfolios: []) }
      assert_equal "AI_DISABLED", error.code
    end
  end

  private

  def with_env(values)
    previous = values.keys.to_h { [_1, ENV[_1]] }
    values.each { |k, v| ENV[k] = v }
    yield
  ensure
    previous.each { |k, v| ENV[k] = v }
  end
end
