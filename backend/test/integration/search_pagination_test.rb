require "test_helper"

# Talent, candidates, acts, global search by type and job search with a query are paged with an
# opaque cursor (?limit=, ?cursor= from nextCursor), like the job list (#69), and report `total`.
class SearchPaginationTest < ActionDispatch::IntegrationTest
  setup do
    @employer = user!("Paging Employer", "employer")
    @employer.create_profile!(company_name: "Paging Employer")
    @base = Time.utc(2026, 9, 1, 12)
  end

  test "the public directory reaches every professional past the old 100 cap" do
    ids = Array.new(105) { |i| professional!("Keys #{i}", "Keyboardist", created_at: @base - i.minutes).id }
    assert_walks("/api/public/talent", "talent", {}, ids, pages: 4)
  end

  test "candidate search pages with the same cursor and keeps the shortlist flag" do
    ids = Array.new(35) { |i| professional!("Cellist #{i}", "Cellist", created_at: @base - i.minutes).id }
    TalentShortlist.create!(employer: @employer, candidate_id: ids.last)
    rows = assert_walks("/api/candidates", "candidates", { q: "cellist" }, ids, pages: 2, headers: auth(@employer))
    assert rows.find { _1["id"] == ids.last }["shortlisted"]
    assert_equal "all", response.parsed_body["matchMode"]
  end

  test "acts page too, and filter by city alias, type, genre and event" do
    owner = professional!("Act Owner", "Vocalist")
    ids = Array.new(33) do |i|
      Act.create!(owner:, name: "Paging Band #{i}", act_type: i.even? ? "band" : "duo", city: "Mumbai", genres: ["Sufi"], event_types: ["wedding"],
        currency: "INR", fee_basis: "event", status: "active", updated_at: @base - i.minutes).id
    end
    Act.create!(owner:, name: "Elsewhere Band", act_type: "band", city: "Goa", genres: ["Rock"], event_types: ["club"], currency: "INR", fee_basis: "event", status: "active")
    assert_walks("/api/public/acts", "acts", { city: "Bombay" }, ids, pages: 2)

    get "/api/public/acts", params: { type: "duo", genre: "sufi", eventType: "wedding", limit: 100 }
    assert_equal 16, response.parsed_body["total"]
    get "/api/public/acts", params: { q: "band", city: "goa" }
    assert_equal ["Elsewhere Band"], response.parsed_body["acts"].pluck("name")
  end

  test "job search with a query pages by relevance and walks every match once" do
    ids = Array.new(40) { |i| job!("Violinist #{i}", created_at: @base - i.minutes).id }
    job!("Drummer only")
    assert_walks("/api/jobs", "jobs", { q: "violin" }, ids, pages: 2)
  end

  test "global search by type is paged; all types report totals and more" do
    Array.new(35) { |i| job!("Zephyr opening #{i}") }
    get "/api/search", params: { q: "zephyr", type: "jobs", limit: 20 }
    body = response.parsed_body
    assert_equal 20, body["results"].size
    assert_equal 35, body["total"]
    assert_equal({ "jobs" => 35 }, body["totals"])
    get "/api/search", params: { q: "zephyr", type: "jobs", limit: 20, cursor: body["nextCursor"] }
    assert_equal 15, response.parsed_body["results"].size
    assert_nil response.parsed_body["nextCursor"]

    get "/api/search", params: { q: "zephyr" }
    body = response.parsed_body
    assert_equal 35, body.dig("totals", "jobs")
    assert_equal 0, body.dig("totals", "acts")
    assert body.dig("moreOf", "jobs"), "30 of 35 jobs shown, so there are more"
    assert_not body.dig("moreOf", "acts")
  end

  test "unreadable or foreign cursors are rejected; an offset past the end is an empty last page" do
    professional!("Solo", "Vocalist")
    ["not-a-cursor", Base64.urlsafe_encode64("[1,2]"), Base64.urlsafe_encode64({ offset: -1 }.to_json)].each do |cursor|
      get "/api/public/talent", params: { cursor: }
      assert_response :bad_request
      assert_equal "INVALID_CURSOR", response.parsed_body["code"]
    end
    get "/api/public/talent", params: { q: "vocalist", cursor: Base64.urlsafe_encode64({ offset: 50 }.to_json, padding: false) }
    assert_response :success
    assert_equal [], response.parsed_body["talent"]
    assert_equal 1, response.parsed_body["total"]
    assert_nil response.parsed_body["nextCursor"]

    job!("Violinist")
    get "/api/jobs", params: { q: "violinist", cursor: "bad" }
    assert_equal "INVALID_CURSOR", response.parsed_body["code"]
    get "/api/public/acts", params: { cursor: "bad" }
    assert_equal "INVALID_CURSOR", response.parsed_body["code"]
    get "/api/search", params: { q: "violinist", type: "jobs", cursor: "bad" }
    assert_equal "INVALID_CURSOR", response.parsed_body["code"]
  end

  private

  # Follows nextCursor from the first page; every id appears exactly once. Returns all rows.
  def assert_walks(path, key, params, ids, pages:, headers: {})
    rows = []
    cursor = nil
    count = 0
    loop do
      get path, params: params.merge(cursor ? { cursor: } : {}), headers: headers
      assert_response :success
      body = response.parsed_body
      assert_equal ids.size, body["total"], "#{path} total"
      rows.concat(body[key])
      count += 1
      cursor = body["nextCursor"]
      break unless cursor
    end
    assert_equal pages, count, "#{path} pages"
    assert_equal ids.sort, rows.pluck("id").sort
    assert_equal rows.pluck("id").uniq.size, rows.size, "no repeats"
    rows
  end

  def user!(name, role, created_at: Time.current)
    User.create!(name:, email: "#{name.parameterize}-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role:, status: "active",
      profile_complete: true, created_at:)
  end

  def professional!(name, role, created_at: Time.current)
    user!(name, "jobseeker", created_at:).tap { _1.create_profile!(headline: "#{role} · Live", roles: [role], location: "Pune") }
  end

  def job!(title, created_at: Time.current)
    Job.create!(employer: @employer, title:, company: "Paging Employer", location: "Mumbai", kind: "Contract", genre: "Classical",
      description: "A paid engagement with rehearsals, written terms and on-site production support for the season.", status: "published", created_at:)
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
