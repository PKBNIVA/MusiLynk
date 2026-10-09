require "test_helper"
require_relative "../support/showcase_helpers"
require_relative "../support/query_budget"

# R4: profiles.rank_score (TalentRank) and keyset paging on the talent directory, the Stage feed and
# notifications: cursors hold the last row's sort key, so rows inserted mid-scroll never repeat or
# shift a later page, and the pre-R4 offset cursors still work for one release.
class KeysetPagingTest < ActionDispatch::IntegrationTest
  include ShowcaseHelpers
  include QueryBudget

  FULL = { headline: "Session drummer", bio: "Studio and stage.", location: "Mumbai", skills: ["Grooves"], genres: ["Bollywood"] }.freeze

  # --- rank_score ------------------------------------------------------------------------------

  test "rank_score packs verified, sample, completeness, rates and recency, and the callbacks keep it fresh" do
    user = make_user("Rank Owner", profile: { headline: "Drummer" })
    assert_equal 100, user.profile.reload.rank_score, "headline only: one completeness point"

    user.profile.update!(FULL.merge(session_rate: 4000))
    assert_equal 510, user.profile.reload.rank_score, "five completeness points and a rate"

    item = make_item(user)
    assert_equal 1_610, user.profile.reload.rank_score, "a playable sample, and the sixth completeness point"

    user.profile.update!(verified: true)
    assert_equal 11_610, user.profile.reload.rank_score

    item.update!(visibility: "private")
    assert_equal 10_610, user.profile.reload.rank_score, "a private sample is not playable, but still counts as a sample"

    item.destroy!
    assert_equal 10_510, user.profile.reload.rank_score
  end

  test "TalentRankJob ages the sign-in recency and repairs scores written around the callbacks" do
    user = make_user("Recent Login", profile: { headline: "Drummer" })
    user.update_columns(last_login_at: 1.hour.ago)
    user.profile.update_columns(rank_score: 0)
    TalentRankJob.perform_now
    assert_equal 103, user.profile.reload.rank_score
    user.update_columns(last_login_at: 20.days.ago)
    TalentRankJob.perform_now
    assert_equal 102, user.profile.reload.rank_score
    user.update_columns(last_login_at: 200.days.ago)
    TalentRankJob.perform_now
    assert_equal 100, user.profile.reload.rank_score
  end

  test "a full TalentRank.refresh! works in id batches and matches a single statement" do
    stub_const_batch = 2
    people = 5.times.map { |n| make_user("Batch #{n}", profile: FULL.merge(session_rate: n.even? ? 4000 : 0)) }
    expected = people.map { _1.profile.reload.rank_score }
    Profile.update_all(rank_score: 0)
    statements = []
    counter = ->(*, payload) { statements << payload[:sql] if payload[:sql].start_with?("UPDATE profiles SET rank_score") }
    original = TalentRank::BATCH_SIZE
    TalentRank.send(:remove_const, :BATCH_SIZE)
    TalentRank.const_set(:BATCH_SIZE, stub_const_batch)
    begin
      ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { TalentRank.refresh! }
    ensure
      TalentRank.send(:remove_const, :BATCH_SIZE)
      TalentRank.const_set(:BATCH_SIZE, original)
    end
    assert_operator statements.length, :>=, Profile.count / stub_const_batch, "one UPDATE per id range, not one for the table"
    assert_equal expected, people.map { _1.profile.reload.rank_score }
  end

  test "the migration's frozen backfill SQL scores profiles exactly as TalentRank does" do
    require Rails.root.join("db/migrate/20261009100000_add_rank_score_to_profiles")
    people = 3.times.map { |n| make_user("Frozen #{n}", profile: FULL.merge(session_rate: n.zero? ? 4000 : 0, verified: n == 1)) }
    make_item(people.first)
    expected = people.map { _1.profile.reload.rank_score }
    Profile.update_all(rank_score: 0)
    migration = AddRankScoreToProfiles.new
    ids = Profile.order(:user_id).pluck(:user_id)
    ActiveRecord::Base.connection.execute(migration.send(:backfill_sql, ids.first, ids.last))
    assert_equal expected, people.map { _1.profile.reload.rank_score }
  end

  # --- talent --------------------------------------------------------------------------------

  test "the talent directory walks every row once by keyset, even when a profile is added mid-scroll" do
    people = 7.times.map { |n| make_user("Keyset #{n}", profile: FULL.merge(session_rate: n.even? ? 4000 : 0)) }
    mine = people.map(&:id)
    get "/api/public/talent", params: { limit: 50 }
    full_order = response.parsed_body["talent"].pluck("id") & mine

    get "/api/public/talent", params: { limit: 3 }
    assert_response :success
    first = response.parsed_body
    assert_equal full_order.first(3), first["talent"].pluck("id") & mine
    assert_equal({ "k" => first["talent"].last.then { [User.find(_1["id"]).profile.rank_score, _1["id"]] } },
      JSON.parse(Base64.urlsafe_decode64(first["nextCursor"])))

    # A new verified profile ranks above everything already served: offset paging would repeat a row.
    newcomer = make_user("Keyset Newcomer", profile: FULL.merge(verified: true))
    seen = first["talent"].pluck("id")
    cursor = first["nextCursor"]
    while cursor
      get "/api/public/talent", params: { limit: 3, cursor: }
      assert_response :success
      seen.concat(response.parsed_body["talent"].pluck("id"))
      assert_operator response.parsed_body["total"], :>=, 8, "a keyset page's total still counts the whole list"
      cursor = response.parsed_body["nextCursor"]
    end
    assert_equal seen.uniq, seen, "no profile is served twice"
    assert_equal full_order, seen & mine, "every profile is reached, in rank order"
    assert_not_includes seen, newcomer.id, "a profile ranked above the cursor is not inserted into later pages"
  end

  test "the talent directory still reads the pre-R4 offset cursor (logged as deprecated) and rejects a malformed keyset cursor" do
    people = 4.times.map { |n| make_user("Legacy #{n}", profile: FULL) }
    get "/api/public/talent", params: { limit: 50 }
    full_order = response.parsed_body["talent"].pluck("id") & people.map(&:id)

    legacy = Base64.urlsafe_encode64({ offset: 2 }.to_json, padding: false)
    logged = capture_log { get "/api/public/talent", params: { limit: 2, cursor: legacy } }
    assert_response :success
    assert_equal full_order.drop(2), response.parsed_body["talent"].pluck("id") & full_order
    assert_match(/"event":"deprecated_offset_cursor","list":"talent"/, logged)

    [{ k: ["high", "x"] }, { k: [1] }, { k: [1, 2] }, { k: [10**30, "a"] }, { k: [-1, "a"] }, { k: [2**31, "a"] }, { k: [1, "a" * 65] }].each do |bad|
      get "/api/public/talent", params: { cursor: Base64.urlsafe_encode64(bad.to_json, padding: false) }
      assert_response :bad_request
      assert_equal "INVALID_CURSOR", response.parsed_body["code"]
    end
  end

  test "a typed talent search keeps its offset cursor without a deprecation line" do
    3.times { |n| make_user("Searchable Drummer #{n}", profile: FULL) }
    get "/api/public/talent", params: { q: "drummer", limit: 2 }
    assert_response :success
    cursor = response.parsed_body["nextCursor"]
    assert_equal({ "offset" => 2 }, JSON.parse(Base64.urlsafe_decode64(cursor)))
    logged = capture_log { get "/api/public/talent", params: { q: "drummer", limit: 2, cursor: } }
    assert_response :success
    assert_no_match(/deprecated_offset_cursor/, logged)
  end

  test "a keyset page of the talent directory costs no more queries than the first page" do
    4.times { |n| make_user("Budget #{n}", profile: FULL) }
    get "/api/public/talent", params: { limit: 2 }
    cursor = response.parsed_body["nextCursor"]
    get "/api/public/talent", params: { limit: 2, cursor: } # warm-up
    assert_queries_at_most(11, "talent keyset page") { get "/api/public/talent", params: { limit: 2, cursor: } }
    assert_response :success
  end

  # --- Stage feed ----------------------------------------------------------------------------

  test "the feed pages by (created_at, id) with no duplicates when a post is published mid-scroll" do
    viewer = make_user("Feed Viewer", profile: {})
    author = make_user("Feed Author", profile: {})
    posts = 25.times.map { |n| stage_post(author, "Post #{n}", (30 - n).minutes.ago) }
    headers = auth(viewer)

    get "/api/stage/feed", headers: headers
    assert_response :success
    first = response.parsed_body
    assert_equal 20, first["posts"].length
    assert_equal posts.last(20).map(&:id).sort, first["posts"].pluck("id").sort, "page one is the newest window"

    fresh = stage_post(author, "Published mid-scroll", Time.current)
    get "/api/stage/feed", params: { cursor: first["nextCursor"] }, headers: headers
    assert_response :success
    second = response.parsed_body
    assert_equal posts.first(5).map(&:id).sort, second["posts"].pluck("id").sort
    assert_nil second["nextCursor"]
    served = first["posts"].pluck("id") + second["posts"].pluck("id")
    assert_equal served.uniq, served
    assert_not_includes served, fresh.id
  end

  test "the feed reaches posts beyond the old 500-post pool, and a page after the first costs a bounded number of queries" do
    viewer = make_user("Deep Viewer", profile: {})
    author = make_user("Deep Author", profile: {})
    now = Time.current
    Post.insert_all(530.times.map { |n| { id: SecureRandom.uuid, author_type: "user", author_id: author.id, created_by_user_id: author.id, body: "Deep #{n}",
      visibility: "public", status: "active", kind: "update", created_at: now - n.minutes, updated_at: now } })
    oldest = Post.order(:created_at).first
    headers = auth(viewer)
    served = []
    cursor = nil
    pages = 0
    loop do
      get "/api/stage/feed", params: { cursor: }.compact, headers: headers
      assert_response :success
      served.concat(response.parsed_body["posts"].pluck("id"))
      cursor = response.parsed_body["nextCursor"]
      pages += 1
      break unless cursor
      assert_queries_at_most(18, "feed keyset page") { get "/api/stage/feed", params: { cursor: }, headers: headers } if pages == 3
    end
    assert_equal 530, served.length
    assert_equal served.uniq, served
    assert_includes served, oldest.id
  end

  test "the feed rejects malformed or out-of-range cursors with INVALID_CURSOR instead of serving page one" do
    viewer = make_user("Bad Cursor Viewer", profile: {})
    headers = auth(viewer)
    bad = [
      "garbage",
      Base64.urlsafe_encode64({ i: "nope" }.to_json),
      Base64.urlsafe_encode64({ t: Time.current.utc.iso8601(6), i: 5 }.to_json),
      Base64.urlsafe_encode64({ t: "not a time", i: "x" }.to_json),
      Base64.urlsafe_encode64({ t: "-4800-01-01T00:00:00Z", i: "x" }.to_json),
      Base64.urlsafe_encode64({ t: "294277-01-01T00:00:00Z", i: "x" }.to_json),
      Base64.urlsafe_encode64([1, 2].to_json),
      Base64.urlsafe_encode64({ t: Time.current.utc.iso8601(6), i: "x" * 65 }.to_json)
    ]
    bad.each do |cursor|
      get "/api/stage/feed", params: { cursor: }, headers: headers
      assert_response :bad_request, "cursor #{cursor}"
      assert_equal "INVALID_CURSOR", response.parsed_body["code"]
    end
    get "/api/stage/feed?cursor[]=x", headers: headers
    assert_response :bad_request
  end

  test "the feed still reads the pre-R4 cursor ({ i, o }) for one release" do
    viewer = make_user("Legacy Viewer", profile: {})
    author = make_user("Legacy Author", profile: {})
    posts = 4.times.map { |n| stage_post(author, "Legacy #{n}", (10 - n).minutes.ago) }
    legacy = Base64.urlsafe_encode64({ i: posts[2].id, o: 2 }.to_json)
    logged = capture_log { get "/api/stage/feed", params: { cursor: legacy }, headers: auth(viewer) }
    assert_response :success
    assert_equal posts.first(2).map(&:id).sort, response.parsed_body["posts"].pluck("id").sort
    assert_match(/"event":"deprecated_offset_cursor","list":"stage_feed"/, logged)
  end

  # --- notifications -------------------------------------------------------------------------

  test "notifications need a sign-in" do
    get "/api/notifications"
    assert_response :unauthorized
  end

  test "notifications page by (created_at, id), only the viewer's, with no duplicates when one arrives mid-scroll" do
    user = make_user("Notified", profile: {})
    other = make_user("Someone Else", profile: {})
    now = Time.current
    mine = 35.times.map { |n| Notification.create!(user:, kind: "system", title: "N#{n}", created_at: now - n.minutes) }
    Notification.create!(user: other, kind: "system", title: "Not yours")
    headers = auth(user)

    get "/api/notifications", headers: headers
    assert_response :success
    first = response.parsed_body
    assert_equal mine.first(30).map(&:id), first["notifications"].pluck("id")
    assert_equal 35, first["unread"]

    arrived = Notification.create!(user:, kind: "system", title: "Arrived mid-scroll")
    get "/api/notifications", params: { cursor: first["nextCursor"] }, headers: headers
    assert_response :success
    second = response.parsed_body
    assert_equal mine.drop(30).map(&:id), second["notifications"].pluck("id")
    assert_nil second["nextCursor"]
    served = first["notifications"].pluck("id") + second["notifications"].pluck("id")
    assert_not_includes served, arrived.id

    get "/api/notifications", params: { limit: 2 }, headers: headers
    assert_equal [arrived.id, mine[0].id], response.parsed_body["notifications"].pluck("id")
    assert response.parsed_body["nextCursor"]
  end

  test "notifications reject a malformed cursor or a list-valued parameter, and a later page stays within budget" do
    user = make_user("Notified Budget", profile: {})
    5.times { |n| Notification.create!(user:, kind: "system", title: "B#{n}") }
    headers = auth(user)
    get "/api/notifications", params: { cursor: "not-a-cursor" }, headers: headers
    assert_response :bad_request
    assert_equal "INVALID_CURSOR", response.parsed_body["code"]
    get "/api/notifications?cursor[]=x", headers: headers
    assert_response :bad_request
    ["-4800-01-01T00:00:00Z", "294277-01-01T00:00:00Z", "1999-12-31T23:59:59Z", "2101-01-01T00:00:00Z"].each do |t|
      get "/api/notifications", params: { cursor: Base64.urlsafe_encode64({ t:, i: "x" }.to_json, padding: false) }, headers: headers
      assert_response :bad_request, "cursor time #{t}"
      assert_equal "INVALID_CURSOR", response.parsed_body["code"]
    end

    get "/api/notifications", params: { limit: 2 }, headers: headers
    cursor = response.parsed_body["nextCursor"]
    get "/api/notifications", params: { limit: 2, cursor: }, headers: headers
    assert_queries_at_most(4, "notifications keyset page") { get "/api/notifications", params: { limit: 2, cursor: }, headers: headers }
    assert_response :success
  end

  private

  def stage_post(author, body, at)
    Post.create!(author_type: "user", author_id: author.id, created_by_user_id: author.id, body:, visibility: "public").tap { _1.update_columns(created_at: at) }
  end

  def capture_log
    io = StringIO.new
    original = Rails.logger
    Rails.logger = ActiveSupport::Logger.new(io)
    yield
    io.string
  ensure
    Rails.logger = original
  end
end
