require "test_helper"

class AutocompleteTaxonomyTest < ActiveSupport::TestCase
  test "matches by prefix first, from the taxonomy, with no AI involved" do
    results = AutocompleteTaxonomy.match("cities", "mum")
    assert_equal [{ value: "Mumbai", source: "taxonomy" }], results
  end

  test "falls back to substring and small edit-distance matches" do
    assert_includes AutocompleteTaxonomy.match("genres", "hop").map { _1[:value] }, "Hip-Hop"
    assert_includes AutocompleteTaxonomy.match("cities", "Chenai").map { _1[:value] }, "Chennai"
  end

  test "instruments and roles are backed by the existing catalog/taxonomy data" do
    assert_includes AutocompleteTaxonomy.match("instruments", "gui").map { _1[:value] }, "Electric Guitar"
    assert_includes AutocompleteTaxonomy.match("roles", "produc").map { _1[:value] }, "Producers & engineers"
  end

  test "an unknown field or blank query returns no matches" do
    assert_empty AutocompleteTaxonomy.match("unknown_field", "mum")
    assert_empty AutocompleteTaxonomy.match("cities", "")
  end

  test "a very long query is truncated rather than blowing up the comparison" do
    assert_nothing_raised { AutocompleteTaxonomy.match("cities", "m" * 500) }
  end
end
