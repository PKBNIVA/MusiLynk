require "test_helper"
require_relative "../support/showcase_helpers"

# ShowcaseSync and the "review changes" inbox: rule matches join on their own, near misses and
# tags read from an item's text become suggestions the owner accepts or rejects.
class ShowcaseSuggestionsTest < ActionDispatch::IntegrationTest
  include ShowcaseHelpers

  setup do
    @me = make_user("Riya Keys", profile: { headline: "Keys" })
    @jazz = Portfolio.create!(owner_type: "user", owner_id: @me.id, title: "Jazz", rules: { "any" => { "genres" => ["Jazz"] } })
    @live_originals = Portfolio.create!(owner_type: "user", owner_id: @me.id, title: "Live originals", rules: { "all" => { "tags" => %w[live original] } })
  end

  test "an item whose text mentions a rule value is suggested, and its tags are suggested too" do
    item = make_item(@me, "Late set", description: "A jazz trio recording on Electric Guitar")
    include_suggestion = ShowcaseSuggestion.find_by!(target_type: "portfolio", target_id: @jazz.id, subject_id: item.id)
    assert_equal ["pending", "include", "user", @me.id], include_suggestion.values_at(:status, :kind, :owner_type, :owner_id)
    assert_match(/mentions jazz/i, include_suggestion.reason)
    tags = ShowcaseSuggestion.find_by!(target_type: "portfolio_item", target_id: item.id, kind: "tags")
    assert_equal ["Jazz"], tags.payload["genres"]
    assert_equal ["Electric Guitar"], tags.payload["instruments"]

    get "/api/suggestions", headers: auth(@me)
    assert_response :success
    assert_equal 2, json["pending"]
    row = json["suggestions"].find { _1["kind"] == "include" }
    assert_equal({ "type" => "portfolio", "id" => @jazz.id, "title" => "Jazz" }, row["target"])
    assert_equal({ "type" => "portfolio_item", "id" => item.id, "title" => "Late set" }, row["subject"])
  end

  test "editing the text withdraws suggestions that cited words which are gone" do
    item = make_item(@me, "Late set", description: "A jazz trio recording on Tabla")
    pending = ShowcaseSuggestion.pending.where(subject_id: item.id)
    assert_equal %w[include tags], pending.pluck(:kind).sort
    assert_match(/mentions .*Tabla/i, ShowcaseSuggestion.find_by!(kind: "tags", target_id: item.id).reason)

    item.update!(description: "A quiet evening at home")
    assert_empty ShowcaseSuggestion.pending.where(subject_id: item.id).where(kind: %w[include tags]).where.not(target_id: item.id).to_a
    assert_equal ["obsolete"], ShowcaseSuggestion.where(subject_id: item.id, kind: "include").pluck(:status).uniq
    assert_equal "obsolete", ShowcaseSuggestion.find_by!(kind: "tags", target_id: item.id).status
  end

  test "accepting tags updates the item, which then joins by rule and settles the include suggestion" do
    item = make_item(@me, "Late set", description: "Jazz standards")
    tags = ShowcaseSuggestion.find_by!(kind: "tags", target_id: item.id)
    post "/api/suggestions/#{tags.id}/accept", headers: auth(@me), as: :json
    assert_response :success
    assert json["applied"]
    assert_equal ["Jazz"], item.reload.genres
    assert_includes @jazz.members.map(&:first), item
    assert_equal "obsolete", ShowcaseSuggestion.find_by!(kind: "include", target_id: @jazz.id).status
    assert AuditLog.exists?(action: "suggestion.accept", entity_id: tags.id)
  end

  test "accepting an include pins the item; rejecting is remembered and never asked again" do
    item = make_item(@me, "Late set", description: "Jazz standards")
    suggestion = ShowcaseSuggestion.find_by!(kind: "include", target_id: @jazz.id)
    post "/api/suggestions/#{suggestion.id}/accept", headers: auth(@me), as: :json
    assert_includes @jazz.reload.pinned_item_ids, item.id
    assert_equal "accepted", suggestion.reload.status
    post "/api/suggestions/#{suggestion.id}/accept", headers: auth(@me), as: :json
    assert_response :success

    other = make_item(@me, "Another", description: "More jazz")
    rejected = ShowcaseSuggestion.find_by!(kind: "include", subject_id: other.id)
    post "/api/suggestions/#{rejected.id}/reject", headers: auth(@me), as: :json
    assert_equal "rejected", rejected.reload.status
    other.update!(title: "Another take")
    assert_equal "rejected", rejected.reload.status
    get "/api/suggestions", params: { status: "rejected" }, headers: auth(@me)
    assert_equal [rejected.id], json["suggestions"].pluck("id")
    get "/api/suggestions", params: { status: "bogus" }, headers: auth(@me)
    assert_response :bad_request
  end

  test "an item with some but not all required tags is a near miss" do
    item = make_item(@me, "Gig", tags: ["live"])
    suggestion = ShowcaseSuggestion.find_by!(target_id: @live_originals.id, subject_id: item.id)
    assert_equal "Has live but not original", suggestion.reason
    item.update!(tags: %w[live original])
    assert_equal "obsolete", suggestion.reload.status
  end

  test "accept-all applies every pending suggestion, optionally for one target" do
    make_item(@me, "One", description: "jazz")
    make_item(@me, "Two", tags: ["live"])
    post "/api/suggestions/accept-all", params: { targetId: @jazz.id }, headers: auth(@me), as: :json
    assert_response :success
    assert_equal 1, json["accepted"].length
    assert_equal 1, @jazz.reload.pinned_item_ids.length
    post "/api/suggestions/accept-all", headers: auth(@me), as: :json
    assert_equal 0, ShowcaseSuggestion.pending.count
  end

  test "a suggestion whose item is gone becomes obsolete on accept" do
    item = make_item(@me, "Doomed", description: "jazz")
    suggestion = ShowcaseSuggestion.find_by!(kind: "include", subject_id: item.id)
    PortfolioItem.where(id: item.id).delete_all
    post "/api/suggestions/#{suggestion.id}/accept", headers: auth(@me), as: :json
    assert_equal [false, "obsolete"], [json["applied"], json.dig("suggestion", "status")]
    item2 = make_item(@me, "Also doomed", description: "jazz")
    assert ShowcaseSuggestion.exists?(subject_id: item2.id)
    item2.destroy!
    assert_not ShowcaseSuggestion.exists?(subject_id: item2.id)
  end

  test "Page suggestions live in the Page's inbox; others' suggestions are not reachable" do
    band = make_act(@me, "The Night Shift")
    band_portfolio = Portfolio.create!(owner_type: "act", owner_id: band.id, title: "Band funk", rules: { "any" => { "genres" => ["Funk"] } })
    item = make_item(@me, "Groove", description: "funk workout")
    suggestion = ShowcaseSuggestion.find_by!(target_id: band_portfolio.id, subject_id: item.id)
    assert_equal ["act", band.id], [suggestion.owner_type, suggestion.owner_id]
    get "/api/suggestions", headers: auth(@me)
    assert_not_includes json["suggestions"].pluck("id"), suggestion.id
    get "/api/suggestions", headers: auth(@me, as: "act:#{band.id}")
    assert_equal [suggestion.id], json["suggestions"].pluck("id")

    other = make_user("Other Person")
    post "/api/suggestions/#{suggestion.id}/accept", headers: auth(other), as: :json
    assert_response :not_found
    post "/api/suggestions/#{suggestion.id}/reject", headers: auth(@me), as: :json
    assert_response :not_found, "acting as yourself cannot reach the Page's inbox"
  end

  test "hidden portfolios, pinned and excluded items raise nothing" do
    @jazz.update!(status: "hidden")
    item = make_item(@me, "Quiet", description: "jazz")
    assert_not ShowcaseSuggestion.exists?(target_id: @jazz.id)
    @live_originals.update!(excluded_item_ids: [item.id])
    item.update!(tags: ["live"])
    assert_not ShowcaseSuggestion.exists?(target_id: @live_originals.id, subject_id: item.id)
  end

  test "the classifier is pluggable and a failing sync never fails the save" do
    original = PortfolioItemClassifier.implementation
    PortfolioItemClassifier.implementation = Class.new { def classify(*) = raise("boom") }.new
    item = nil
    assert_nothing_raised { item = make_item(@me, "Saved anyway", description: "jazz") }
    assert item.persisted?
    assert_not ShowcaseSuggestion.exists?(subject_id: item.id)
  ensure
    PortfolioItemClassifier.implementation = original
  end

  test "creating a work sample through the API runs the sync" do
    post "/api/portfolio", params: { type: "audio", title: "Blue set", url: "https://example.com/b.mp3", description: "jazz trio" }, headers: auth(@me), as: :json
    assert_response :created
    assert ShowcaseSuggestion.exists?(subject_id: json["id"], kind: "tags")
  end
end
