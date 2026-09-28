require "test_helper"

class ShowcaseRulesTest < ActiveSupport::TestCase
  def rules(raw) = ShowcaseRules.new(raw, dims: Portfolio::DIMS, sorts: Portfolio::SORTS)

  test "any, all, only, exclude and years combine as documented" do
    jazz_live = { "genres" => ["Jazz"], "tags" => %w[live original] }
    assert rules("any" => { "genres" => ["jazz", "blues"] }).match?(jazz_live)
    assert_not rules("any" => { "genres" => ["rock"] }).match?(jazz_live)
    assert rules("all" => { "tags" => ["LIVE", "original"] }).match?(jazz_live)
    assert_not rules("all" => { "tags" => %w[live cover] }).match?(jazz_live)
    assert_not rules({}).match?(jazz_live), "no criteria matches nothing"
    assert rules("everything" => true).match?(jazz_live)
    assert_not rules("everything" => true, "exclude" => { "tags" => ["live"] }).match?(jazz_live)
    assert rules("everything" => true, "only" => { "genres" => ["jazz"] }).match?(jazz_live)
    assert_not rules("everything" => true, "only" => { "genres" => ["rock"] }).match?(jazz_live)
    assert rules("everything" => true, "only" => { "roles" => ["drummer"] }).match?(jazz_live), "nothing stated, nothing ruled out"
    assert rules("everything" => true, "yearFrom" => 2020).match?(jazz_live, 2021)
    assert_not rules("everything" => true, "yearTo" => 2020).match?(jazz_live, 2021)
    assert_not rules("everything" => true, "yearFrom" => 2020).match?(jazz_live, nil)
    assert_not rules("junk").match?(jazz_live)
    assert_equal "featured", rules("junk").sort
  end

  test "near misses" do
    set = rules("any" => { "genres" => ["jazz"] })
    assert_match(/mentions jazz/, set.near_miss({}, { "genres" => ["Jazz"] }))
    assert_nil set.near_miss({ "genres" => ["jazz"] }, {}), "already a member"
    assert_nil set.near_miss({}, {})
    partial = rules("all" => { "tags" => %w[live original] })
    assert_equal "Has live but not original", partial.near_miss({ "tags" => ["live"] }, {})
    assert_nil rules("all" => { "tags" => ["live"] }, "exclude" => { "tags" => ["cover"] }).near_miss({ "tags" => ["cover"] }, { "tags" => ["live"] })
    assert_nil rules("everything" => true, "yearFrom" => 2020).near_miss({}, {}, 2010)
    assert_nil rules("any" => { "genres" => ["rock"] }, "all" => { "tags" => %w[a b] }).near_miss({ "tags" => ["a"] }, {})
    assert_nil rules("junk").near_miss({}, {})
  end

  test "errors describe every malformed part" do
    assert_equal ["must be an object"], rules([]).errors
    errors = rules("any" => { "colour" => ["red"] }, "all" => "x", "only" => { "tags" => [1] }, "everything" => "yes", "yearFrom" => 3000, "sort" => "x", "extra" => 1).errors
    assert_equal 7, errors.length, errors.inspect
    assert_includes rules("yearFrom" => 2024, "yearTo" => 2020).errors, "yearTo must not be before yearFrom"
    assert_empty rules("everything" => true, "any" => { "genres" => ["Jazz"] }, "sort" => "manual").errors
    assert_equal({ "genres" => %w[Jazz Blues], "tags" => ["live"] }, rules("any" => { "genres" => ["Jazz"] }, "only" => { "genres" => ["Blues"] }, "exclude" => { "tags" => ["live"] }).vocabulary)
  end

  test "the keyword classifier finds taxonomy terms as whole words" do
    classifier = PortfolioItemClassifier::Keyword.new
    found = classifier.classify_text("Jazz trio, live at a wedding with Tabla and a Drummer; not jazzercise")
    assert_equal ["Jazz"], found["genres"]
    assert_equal ["Tabla"], found["instruments"]
    assert_includes found["roles"], "Drummer"
    assert_equal %w[live wedding], found["tags"]
    assert_equal({ "roles" => [], "genres" => [], "instruments" => [], "tags" => [] }, classifier.classify_text(" "))
    assert_equal ["Gypsy swing"], classifier.classify_text("some gypsy swing", extra: { "genres" => ["Gypsy swing"] })["genres"]
  end

  test "master copies for each kind of owner" do
    org = Organization.new(name: "Studio", city: "Pune")
    assert_equal "Pune", ShowcaseMaster.for(org)["city"]
    assert_nil ShowcaseMaster.for(nil)["headline"]
    assert_nil ShowcaseMaster.user(User.new(name: "No Profile"))["headline"]
    assert_nil ShowcaseMaster.act(Act.new(name: "Band"))["rates"]
    assert PageDirectory.public?(User.new(status: "active"))
    assert_not PageDirectory.public?(Object.new)
    assert_nil PageDirectory.find("venue", "1")
  end
end
