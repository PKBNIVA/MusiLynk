require "test_helper"

# GET /api/jobs is paged with an opaque keyset cursor (?limit=, ?cursor= from nextCursor).
class JobListPagingTest < ActionDispatch::IntegrationTest
  setup do
    @employer = User.create!(name: "Paging Studio", email: "paging-studio@example.com", password: "StrongPass123!", role: "employer", status: "active", profile_complete: true)
    @employer.create_profile!(company_name: "Paging Studio", verified: true)
    @other = User.create!(name: "Other Studio", email: "paging-other@example.com", password: "StrongPass123!", role: "employer", status: "active", profile_complete: true)
    @other.create_profile!(company_name: "Other Studio", verified: false)
  end

  test "defaults to 30 per page, walks every job exactly once, newest published first (V-16)" do
    base = Time.utc(2026, 9, 1, 12)
    # Several share a published_at so the cursor must break ties on id. Featured no longer
    # jumps the queue for browsing: only published_at (then id) decides the order.
    jobs = Array.new(65) { |i| job!(published_at: base - (i / 3).minutes, featured: i % 20 == 0) }
    ids = jobs.map(&:id)

    get "/api/jobs"
    assert_response :success
    first = response.parsed_body
    assert_equal JobsController::PAGE_SIZE, first["jobs"].length
    assert_equal 65, first["total"]
    assert first["nextCursor"].present?
    newest = jobs.max_by { |j| [j.published_at, j.id] }
    assert_equal newest.id, first["jobs"].first["id"], "the most recently published job leads the first page"
    published_ats = first["jobs"].pluck("published_at")
    assert_equal published_ats, published_ats.sort.reverse, "the page is sorted newest-published first"

    seen = first["jobs"].pluck("id")
    cursor = first["nextCursor"]
    pages = 1
    while cursor
      get "/api/jobs", params: { cursor: }
      assert_response :success
      seen.concat(response.parsed_body["jobs"].pluck("id"))
      assert_equal 65, response.parsed_body["total"]
      cursor = response.parsed_body["nextCursor"]
      pages += 1
    end
    assert_equal 3, pages
    assert_equal ids.sort, seen.sort
    assert_equal seen.uniq, seen, "no job is repeated across pages"
  end

  test "page 2 has no duplicates and no gaps across 30 fixtures sharing a published_at" do
    base = Time.utc(2026, 9, 5, 9)
    ids = Array.new(30) { job!(published_at: base).id }

    get "/api/jobs", params: { limit: 15 }
    first_page = response.parsed_body
    assert_equal 15, first_page["jobs"].length
    assert first_page["nextCursor"].present?

    get "/api/jobs", params: { limit: 15, cursor: first_page["nextCursor"] }
    second_page = response.parsed_body
    assert_equal 15, second_page["jobs"].length
    assert_nil second_page["nextCursor"]

    combined = first_page["jobs"].pluck("id") + second_page["jobs"].pluck("id")
    assert_equal ids.sort, combined.sort, "every fixture appears exactly once across the two pages"
    assert_equal combined.uniq, combined, "no id is duplicated between page 1 and page 2"
  end

  test "a job published after the page-1 fetch does not break page-2 continuity" do
    base = Time.utc(2026, 9, 10, 12)
    older = Array.new(20) { |i| job!(published_at: base - (i + 1).minutes).id }

    get "/api/jobs", params: { limit: 10 }
    first_page = response.parsed_body
    assert_equal 10, first_page["jobs"].length
    page_one_ids = first_page["jobs"].pluck("id")

    # A newer job is published while the visitor is still on page 1: it sorts before the cursor
    # position, so it must not appear on page 2 and must not push an already-seen job back onto
    # it either.
    fresh = job!(published_at: base + 1.minute).id

    get "/api/jobs", params: { limit: 10, cursor: first_page["nextCursor"] }
    second_page = response.parsed_body
    page_two_ids = second_page["jobs"].pluck("id")

    assert_not_includes page_two_ids, fresh
    assert_empty page_one_ids & page_two_ids, "no job repeats across pages after a newer one is published"
    assert_equal (older - page_one_ids).sort, page_two_ids.sort
  end

  test "limit is honoured, clamped to 1..MAX_PAGE_SIZE, and unreadable values use the default" do
    5.times { |i| job!(created_at: Time.utc(2026, 9, 1) - i.hours) }

    get "/api/jobs", params: { limit: 2 }
    assert_equal 2, response.parsed_body["jobs"].length
    get "/api/jobs", params: { limit: 2, cursor: response.parsed_body["nextCursor"] }
    assert_equal 2, response.parsed_body["jobs"].length
    get "/api/jobs", params: { limit: 2, cursor: response.parsed_body["nextCursor"] }
    assert_equal 1, response.parsed_body["jobs"].length
    assert_nil response.parsed_body["nextCursor"], "the last page has no next cursor"

    get "/api/jobs", params: { limit: 0 }
    assert_equal 1, response.parsed_body["jobs"].length, "limit below 1 is raised to 1"

    (JobsController::MAX_PAGE_SIZE + 2 - 5).times { |i| job!(created_at: Time.utc(2026, 8, 1) - i.minutes) }
    get "/api/jobs", params: { limit: 5000 }
    assert_equal JobsController::MAX_PAGE_SIZE, response.parsed_body["jobs"].length
    assert response.parsed_body["nextCursor"].present?

    get "/api/jobs", params: { limit: -3 }
    assert_equal 1, response.parsed_body["jobs"].length, "negative limits are raised to 1"
    get "/api/jobs", params: { limit: 10**30 }
    assert_equal JobsController::MAX_PAGE_SIZE, response.parsed_body["jobs"].length
    ["ten", "2.5", ""].each do |bad|
      get "/api/jobs", params: { limit: bad }
      assert_response :success
      assert_equal JobsController::PAGE_SIZE, response.parsed_body["jobs"].length, bad.inspect
    end
    get "/api/jobs?limit[]=2"
    assert_response :bad_request
    assert_equal "INVALID_FILTER", response.parsed_body["code"]
  end

  test "an unreadable cursor is a 400, not a 500" do
    job!
    bad_cursors = ["not base64 at all!", Base64.urlsafe_encode64("{}"), Base64.urlsafe_encode64("[1,2]"),
                   Base64.urlsafe_encode64('[true,"yesterday","x"]'), Base64.urlsafe_encode64('[true,"2026-01-01T00:00:00Z",""]')]
    bad_cursors.each do |cursor|
      get "/api/jobs", params: { cursor: }
      assert_response :bad_request
      assert_equal "INVALID_CURSOR", response.parsed_body["code"], cursor
    end
    get "/api/jobs?cursor[]=x"
    assert_response :bad_request
  end

  test "filters apply to every page and to the total" do
    12.times { |i| job!(created_at: Time.utc(2026, 9, 1) - i.minutes, title: "Session bassist #{i}", employer: i.even? ? @employer : @other) }
    6.times { |i| job!(created_at: Time.utc(2026, 9, 2) - i.minutes, title: "Lighting tech #{i}") }

    get "/api/jobs", params: { q: "bassist", limit: 4 }
    body = response.parsed_body
    assert_equal 12, body["total"]
    ids = body["jobs"].pluck("id")
    cursor = body["nextCursor"]
    while cursor
      get "/api/jobs", params: { q: "bassist", limit: 4, cursor: }
      assert response.parsed_body["jobs"].all? { _1["title"].start_with?("Session bassist") }
      ids.concat(response.parsed_body["jobs"].pluck("id"))
      cursor = response.parsed_body["nextCursor"]
    end
    assert_equal 12, ids.uniq.length

    get "/api/jobs", params: { q: "bassist", verified: "true", limit: 4 }
    assert_equal 6, response.parsed_body["total"]
    get "/api/jobs", params: { q: "bassist", verified: "true", limit: 4, cursor: response.parsed_body["nextCursor"] }
    assert_equal 2, response.parsed_body["jobs"].length
    assert response.parsed_body["jobs"].all? { _1["employerVerified"] }
    assert_nil response.parsed_body["nextCursor"]
  end

  test "saved flags are set for jobs on the page for a signed-in professional" do
    seeker = User.create!(name: "Paging Seeker", email: "paging-seeker@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", profile_complete: true)
    jobs = 3.times.map { |i| job!(created_at: Time.utc(2026, 9, 1) - i.minutes) }
    SavedJob.create!(user: seeker, job: jobs.last)
    raw = SecureRandom.urlsafe_base64(48)
    seeker.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 1.day.from_now)
    headers = { "Authorization" => "Bearer #{raw}" }

    get "/api/jobs", params: { limit: 2 }, headers: headers
    assert_equal [false, false], response.parsed_body["jobs"].pluck("saved")
    get "/api/jobs", params: { limit: 2, cursor: response.parsed_body["nextCursor"] }, headers: headers
    assert_equal [[jobs.last.id, true]], response.parsed_body["jobs"].map { [_1["id"], _1["saved"]] }
  end

  private

  def job!(created_at: Time.current, published_at: created_at, featured: false, title: "Paged drummer", employer: @employer)
    Job.create!(employer:, title:, company: employer.name, location: "Pune", kind: "Contract", genre: "Pop", featured:,
                description: "A paid engagement with clear terms, a fixed schedule, agreed fees and a written contract.",
                status: "published", published_at:, created_at:)
  end
end
