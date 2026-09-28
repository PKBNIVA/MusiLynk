require "test_helper"
require_relative "../support/showcase_helpers"

# Portfolios as views over one library: rules, pins, exclusions, inherited fields, Page ownership.
class PortfoliosTest < ActionDispatch::IntegrationTest
  include ShowcaseHelpers

  setup do
    @me = make_user("Riya Keys", profile: { headline: "Keys player", bio: "Master bio", location: "Mumbai", genres: ["Jazz"], session_rate: 5000 })
    @jazz = make_item(@me, "Blue in green", genres: ["Jazz"], featured: true, year: 2021)
    @rock = make_item(@me, "Loud night", genres: ["Rock"], tags: ["live"], year: 2019)
    @bare = make_item(@me, "Untitled demo", year: 2023)
    @other = make_user("Other Person")
    @others_item = make_item(@other, "Not mine", genres: ["Jazz"])
  end

  test "create computes membership from rules, pins and exclusions" do
    post "/api/portfolios", params: { title: "Jazz work", rules: { any: { genres: ["jazz"] } }, pinnedItemIds: [@bare.id] }, headers: auth(@me), as: :json
    assert_response :created
    portfolio = json["portfolio"]
    assert_equal [@jazz.id, @bare.id], portfolio["items"].pluck("itemId")
    assert_equal %w[rule pinned], portfolio["items"].pluck("source")
    assert portfolio["isDefault"], "the first portfolio becomes the default"
    assert_match(/\Ajazz-work-[a-z0-9]{6}\z/, portfolio["slug"])
    assert_equal "portfolios.create", AuditLog.where(entity_id: json["id"]).last.action

    put "/api/portfolios/#{json['id']}/items/#{@jazz.id}", params: { state: "excluded" }, headers: auth(@me), as: :json
    assert_response :success
    assert_equal [@bare.id], json.dig("portfolio", "items").pluck("itemId")
    put "/api/portfolios/#{json.dig('portfolio', 'id')}/items/#{@jazz.id}", params: { state: "auto" }, headers: auth(@me), as: :json
    assert_equal [@jazz.id, @bare.id], json.dig("portfolio", "items").pluck("itemId")
  end

  test "a new library item that matches the rules joins every matching portfolio on its own" do
    everything = Portfolio.create!(owner_type: "user", owner_id: @me.id, title: "All", rules: { "everything" => true })
    jazz = Portfolio.create!(owner_type: "user", owner_id: @me.id, title: "Jazz", rules: { "any" => { "genres" => ["Jazz"] } })
    fresh = make_item(@me, "New standard", genres: ["jazz"])
    assert_includes everything.members.map(&:first), fresh
    assert_includes jazz.members.map(&:first), fresh

    fresh.update!(genres: ["Rock"])
    assert_not_includes jazz.members.map(&:first), fresh
  end

  test "sorting by newest and by a manual order" do
    portfolio = Portfolio.create!(owner_type: "user", owner_id: @me.id, title: "All", rules: { "everything" => true, "sort" => "newest" })
    assert_equal [@bare, @jazz, @rock], portfolio.members.map(&:first)
    portfolio.update!(rules: { "everything" => true, "sort" => "manual" }, item_order: [@rock.id, @bare.id])
    assert_equal [@rock, @bare, @jazz], portfolio.members.map(&:first)
    portfolio.update!(rules: { "everything" => true, "yearFrom" => 2020, "yearTo" => 2022 })
    assert_equal [@jazz], portfolio.members.map(&:first)
  end

  test "fields inherit the master copy until overridden, and reset returns to it" do
    post "/api/portfolios", params: { title: "Sessions" }, headers: auth(@me), as: :json
    id = json["id"]
    body = json["portfolio"]
    assert_equal ["Keys player", "Master bio", "Mumbai", ["Jazz"]], body.values_at("headline", "bio", "city", "genres")
    assert_equal({ "min" => 5000, "max" => 5000, "currency" => "INR", "basis" => "session" }, body["rates"])
    assert_empty body["overridden"]

    patch "/api/portfolios/#{id}", params: { headline: "Session keys", genres: ["Funk"], rates: { min: 1, max: 9, currency: "INR", basis: "hour" } }, headers: auth(@me), as: :json
    assert_response :success
    assert_equal ["Session keys", ["Funk"]], json["portfolio"].values_at("headline", "genres")
    assert_equal %w[headline genres rates], json.dig("portfolio", "overridden")
    assert_equal "Keys player", json.dig("portfolio", "master", "headline")

    # Editing the master copy flows into every field that is not overridden.
    @me.profile.update!(bio: "New master bio", headline: "Pianist")
    get "/api/portfolios/#{id}", headers: auth(@me)
    assert_equal ["Session keys", "New master bio"], json["portfolio"].values_at("headline", "bio")

    post "/api/portfolios/#{id}/reset", params: { fields: ["headline"] }, headers: auth(@me), as: :json
    assert_response :success
    assert_equal ["Pianist", %w[genres rates]], [json.dig("portfolio", "headline"), json.dig("portfolio", "overridden")]
    patch "/api/portfolios/#{id}", params: { genres: nil }, headers: auth(@me), as: :json
    assert_equal ["rates"], json.dig("portfolio", "overridden")
    post "/api/portfolios/#{id}/reset", headers: auth(@me), as: :json
    assert_empty json.dig("portfolio", "overridden")
    post "/api/portfolios/#{id}/reset", params: { fields: ["title"] }, headers: auth(@me), as: :json
    assert_response :unprocessable_content
  end

  test "validation: rules, rates, genres, ids outside the library and malformed lists" do
    [
      { title: "x", rules: { any: { colour: ["red"] } } },
      { title: "x", rules: { sort: "random" } },
      { title: "x", rules: { yearFrom: 2024, yearTo: 2020 } },
      { title: "x", rules: "everything" },
      { title: "x", rates: { min: -1 } },
      { title: "x", rates: { currency: "rupees" } },
      { title: "x", rates: { basis: "forever" } },
      { title: "x", rates: { tip: 5 } },
      { title: "x", genres: [""] },
      { title: "x", genres: Array.new(21) { "G#{_1}" } },
      { title: "x", visibility: "secret" },
      { title: "x" * 121 }
    ].each do |params|
      post "/api/portfolios", params:, headers: auth(@me), as: :json
      assert_response :unprocessable_content, params.inspect
    end
    post "/api/portfolios", params: { title: "x", pinnedItemIds: [@others_item.id] }, headers: auth(@me), as: :json
    assert_response :unprocessable_content
    assert_equal "INVALID_ITEM", json["code"]
    post "/api/portfolios", params: { title: "x", excludedItemIds: [{ id: 1 }] }, headers: auth(@me), as: :json
    assert_response :unprocessable_content
    post "/api/portfolios", params: { title: "x", itemOrder: nil }, headers: auth(@me), as: :json
    assert_response :created
    assert_equal [], json.dig("portfolio", "itemOrder")
  end

  test "another person's portfolio is invisible and untouchable" do
    theirs = Portfolio.create!(owner_type: "user", owner_id: @other.id, title: "Theirs")
    get "/api/portfolios/#{theirs.id}", headers: auth(@me)
    assert_response :not_found
    patch "/api/portfolios/#{theirs.id}", params: { title: "Mine" }, headers: auth(@me), as: :json
    assert_response :not_found
    put "/api/portfolios/#{theirs.id}/items/#{@jazz.id}", params: { state: "pinned" }, headers: auth(@me), as: :json
    assert_response :not_found
    delete "/api/portfolios/#{theirs.id}", headers: auth(@me)
    assert_response :not_found
    assert_equal "Theirs", theirs.reload.title
    mine = Portfolio.create!(owner_type: "user", owner_id: @me.id, title: "Mine")
    put "/api/portfolios/#{mine.id}/items/#{@others_item.id}", params: { state: "pinned" }, headers: auth(@me), as: :json
    assert_response :not_found
  end

  test "Page portfolios: managed while acting as the Page, over the Page owner's library" do
    studio = make_org(@me, "Riya Studios")
    band = make_act(@me, "The Night Shift")
    band.update!(tagline: "Jazz quartet", city: "Pune", genres: ["Jazz"], min_fee: 10_000, max_fee: 50_000)
    post "/api/portfolios", params: { title: "Band live", rules: { everything: true } }, headers: auth(@me, as: "act:#{band.id}"), as: :json
    assert_response :created
    body = json["portfolio"]
    assert_equal ["act", band.id, "The Night Shift"], body.values_at("ownerType", "ownerId", "ownerName")
    assert_equal ["Jazz quartet", "Pune", { "min" => 10_000, "max" => 50_000, "currency" => "INR", "basis" => "event" }], body.values_at("headline", "city", "rates")
    assert_equal 3, body["itemCount"]

    get "/api/portfolios", headers: auth(@me)
    assert_empty json["portfolios"], "personal list does not include the Page's"
    get "/api/portfolios", headers: auth(@me, as: "act:#{band.id}")
    assert_equal [body["id"]], json["portfolios"].pluck("id")
    assert_equal 3, json["portfolios"].first["itemIds"].length
    get "/api/portfolios/#{body['id']}", headers: auth(@me)
    assert_response :not_found

    post "/api/portfolios", params: { title: "Studio" }, headers: auth(@me, as: "organization:#{studio.id}"), as: :json
    assert_nil json.dig("portfolio", "city"), "an organization without a city has none to inherit"
    assert_equal "organization", json.dig("portfolio", "ownerType")

    # An organization admin (not the owner) manages it over the owner's library.
    admin = make_user("Studio Admin")
    studio.organization_members.create!(user: admin, role: "admin")
    get "/api/portfolios", headers: auth(admin, as: "organization:#{studio.id}")
    assert_equal 1, json["portfolios"].length
    put "/api/portfolios/#{json['portfolios'].first['id']}/items/#{@jazz.id}", params: { state: "pinned" }, headers: auth(admin, as: "organization:#{studio.id}"), as: :json
    assert_response :success
  end

  test "a plain member, a hidden act and a stranger's page are refused" do
    label = make_org(@other, "Some Label")
    label.organization_members.create!(user: @me, role: "member")
    hidden = make_act(@me, "Old Band", status: "hidden")
    stranger_act = make_act(@other, "Their Band")
    ["organization:#{label.id}", "act:#{hidden.id}", "act:#{stranger_act.id}"].each do |key|
      post "/api/portfolios", params: { title: "Nope" }, headers: auth(@me, as: key), as: :json
      assert_response :forbidden, key
      get "/api/portfolios", headers: auth(@me, as: key)
      assert_response :forbidden, key
    end
    assert_equal 0, Portfolio.count
  end

  test "one default per owner, handed on when the default is deleted" do
    first = Portfolio.create!(owner_type: "user", owner_id: @me.id, title: "First", is_default: true)
    second = Portfolio.create!(owner_type: "user", owner_id: @me.id, title: "Second")
    post "/api/portfolios/#{second.id}/default", headers: auth(@me), as: :json
    assert_response :success
    assert_equal [false, true], [first.reload.is_default, second.reload.is_default]
    post "/api/portfolios", params: { title: "Third", isDefault: true }, headers: auth(@me), as: :json
    third = Portfolio.find(json["id"])
    assert_equal [false, true], [second.reload.is_default, third.is_default]
    delete "/api/portfolios/#{third.id}", headers: auth(@me)
    assert_response :success
    assert_equal 1, Portfolio.where(owner_type: "user", owner_id: @me.id, is_default: true).count
    assert AuditLog.exists?(entity_id: third.id, action: "portfolios.destroy")
  end

  test "caps portfolios per owner and rate-limits creates" do
    Portfolio::MAX_PER_OWNER.times { |index| Portfolio.create!(owner_type: "user", owner_id: @me.id, title: "P#{index}") }
    post "/api/portfolios", params: { title: "One too many" }, headers: auth(@me), as: :json
    assert_response :unprocessable_content
    assert_equal "LIMIT_REACHED", json["code"]

    with_counting_cache do
      headers = auth(@other)
      PortfoliosController::CREATES_PER_HOUR.times { post "/api/portfolios", params: { title: "" }, headers:, as: :json }
      post "/api/portfolios", params: { title: "Late" }, headers:, as: :json
      assert_response :too_many_requests
    end
  end

  test "the public page shows public and link-only portfolios with public items only" do
    @bare.update!(visibility: "private")
    portfolio = Portfolio.create!(owner_type: "user", owner_id: @me.id, title: "EPK", rules: { "everything" => true }, visibility: "link")
    get "/api/public/portfolios/#{portfolio.slug}"
    assert_response :success
    body = json["portfolio"]
    assert_equal [@jazz.id, @rock.id], body["items"].pluck("itemId")
    assert_equal "Keys player", body["headline"]
    assert_not body.key?("rules")
    assert_not body.key?("pinnedItemIds")

    portfolio.update!(visibility: "private")
    get "/api/public/portfolios/#{portfolio.slug}"
    assert_response :not_found
    portfolio.update!(visibility: "public", status: "hidden")
    get "/api/public/portfolios/#{portfolio.slug}"
    assert_response :not_found
    portfolio.update!(status: "active")
    @me.update!(status: "suspended")
    get "/api/public/portfolios/#{portfolio.slug}"
    assert_response :not_found

    band = make_act(@other, "Their Band", status: "inactive")
    act_portfolio = Portfolio.create!(owner_type: "act", owner_id: band.id, title: "Band EPK")
    get "/api/public/portfolios/#{act_portfolio.slug}"
    assert_response :not_found
    get "/api/public/portfolios/nope"
    assert_response :not_found
  end

  test "draft by elimination proposes rules from the goal and explains each item" do
    post "/api/portfolios/draft", params: { goal: "Jazz sessions", title: "Jazz sessions" }, headers: auth(@me), as: :json
    assert_response :success
    draft = json["draft"]
    assert_equal({ "everything" => true, "sort" => "featured", "only" => { "genres" => ["Jazz"] } }, draft["rules"])
    verdicts = draft["items"].index_by { _1["itemId"] }
    assert verdicts[@jazz.id]["included"]
    assert_match(/matches Jazz/i, verdicts[@jazz.id]["reason"])
    assert_not verdicts[@rock.id]["included"]
    assert_match(/Removed: genres Rock, not Jazz/, verdicts[@rock.id]["reason"])
    assert verdicts[@bare.id]["included"], "an item that states no genre is not ruled out"
    assert_equal({ "total" => 3, "kept" => 2, "removed" => 1 }, draft["summary"])

    # The draft saves as-is and the saved portfolio agrees with the preview.
    post "/api/portfolios", params: draft.slice("title", "purpose", "rules"), headers: auth(@me), as: :json
    assert_response :created
    assert_equal [@jazz.id, @bare.id], json.dig("portfolio", "items").pluck("itemId")

    post "/api/portfolios/draft", params: { purpose: "teaching" }, headers: auth(@me), as: :json
    assert_response :success
    assert_equal 3, json.dig("draft", "summary", "kept")
    assert json.dig("draft", "note")
    post "/api/portfolios/draft", params: { goal: "x" * 501 }, headers: auth(@me), as: :json
    assert_response :unprocessable_content
  end

  test "signed-out and admin callers are refused" do
    get "/api/portfolios"
    assert_response :unauthorized
    admin = User.create!(name: "Admin Person", email: "admin-#{SecureRandom.hex(3)}@example.com", password: PASSWORD, role: "admin", status: "active")
    get "/api/portfolios", headers: auth(admin)
    assert_response :forbidden
  end

  test "deleting a Page deletes its portfolios" do
    band = make_act(@me, "Short Lived")
    Portfolio.create!(owner_type: "act", owner_id: band.id, title: "Band")
    assert_difference -> { Portfolio.count }, -1 do
      band.destroy!
    end
  end
end
