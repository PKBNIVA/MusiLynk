require "test_helper"

class EventsControllerTest < ActionDispatch::IntegrationTest
  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown do
    Rails.cache = @original_cache
  end

  test "accepts an allow-listed batch anonymously" do
    post "/api/events", params: { events: [{ name: "landing_view", anonId: "anon-1", page: "/" }, { name: "path_chosen", anonId: "anon-1", props: { path: "hire" } }] }, as: :json
    assert_response :success
    body = response.parsed_body
    assert_equal 2, body.fetch("accepted")
    assert_equal 0, body.fetch("dropped")
    assert_equal %w[landing_view path_chosen], ProductEvent.order(:created_at).pluck(:name)
  end

  test "drops events with a name outside the allow-list without failing the batch" do
    post "/api/events", params: { events: [{ name: "landing_view", anonId: "anon-2" }, { name: "totally_made_up", anonId: "anon-2" }] }, as: :json
    assert_response :success
    assert_equal 1, response.parsed_body.fetch("accepted")
    assert_equal 1, response.parsed_body.fetch("dropped")
    assert_equal 1, ProductEvent.where(anon_id: "anon-2").count
  end

  test "drops an event missing anonId" do
    post "/api/events", params: { events: [{ name: "landing_view" }] }, as: :json
    assert_response :success
    assert_equal 0, response.parsed_body.fetch("accepted")
  end

  test "rejects an empty or oversized batch" do
    post "/api/events", params: { events: [] }, as: :json
    assert_response :unprocessable_content

    big_batch = Array.new(26) { { name: "landing_view", anonId: "anon-3" } }
    post "/api/events", params: { events: big_batch }, as: :json
    assert_response :unprocessable_content
    assert_equal "BATCH_TOO_LARGE", response.parsed_body.fetch("code")
  end

  test "drops an event whose props push it over the 1KB size cap" do
    # Each prop value is truncated to 200 chars, so many keys (not one giant string) are what
    # push the serialized event past the 1KB cap.
    big_props = (1..10).to_h { |i| ["field_#{i}", "x" * 200] }
    post "/api/events", params: { events: [{ name: "job_posted", anonId: "anon-4", props: big_props }] }, as: :json
    assert_response :success
    assert_equal 0, response.parsed_body.fetch("accepted")
    assert_equal 0, ProductEvent.where(anon_id: "anon-4").count
  end

  test "never stores an email-like prop key or free-text values beyond 200 chars" do
    post "/api/events", params: { events: [{ name: "job_posted", anonId: "anon-5", props: { email: "person@example.com", title: "x" * 300, count: 3, ok: true } }] }, as: :json
    assert_response :success
    event = ProductEvent.find_by(anon_id: "anon-5")
    assert event
    refute event.props.key?("email")
    assert_equal 200, event.props.fetch("title").length
    assert_equal 3, event.props.fetch("count")
    assert_equal true, event.props.fetch("ok")
  end

  test "records the signed-in user's id alongside the anon id" do
    user = User.create!(name: "Events User", email: "events-user-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)

    post "/api/events", params: { events: [{ name: "signup_completed", anonId: "anon-6" }] },
      headers: { "Authorization" => "Bearer #{raw}" }, as: :json
    assert_response :success
    assert_equal user.id, ProductEvent.find_by(anon_id: "anon-6").user_id
  end

  test "rate limits a burst of requests from the same IP" do
    # The throttle bucket is a wall-clock minute; freeze it so the burst cannot straddle two buckets.
    freeze_time
    EventsController::RATE_LIMIT_PER_MINUTE.times do
      post "/api/events", params: { events: [{ name: "landing_view", anonId: "anon-rl" }] }, as: :json
      assert_response :success
    end
    post "/api/events", params: { events: [{ name: "landing_view", anonId: "anon-rl" }] }, as: :json
    assert_response :too_many_requests
  end

  test "the four signup funnel events are accepted and counted by the admin funnel" do
    post "/api/events", params: { events: [
      { name: "landing_view", anonId: "anon-funnel" },
      { name: "path_chosen", anonId: "anon-funnel", props: { path: "musician" } },
      { name: "signup_started", anonId: "anon-funnel", props: { role: "jobseeker" } },
      { name: "signup_completed", anonId: "anon-funnel", props: { role: "jobseeker" } },
      { name: "profile_link_added", anonId: "anon-funnel", props: { kind: "youtube" } }
    ] }, as: :json
    assert_equal 5, response.parsed_body.fetch("accepted")

    counts = FunnelQueries.funnel(1.day.ago).to_h { [_1[:step], _1[:count]] }
    assert_equal 1, counts["path_chosen"]
    assert_equal 1, counts["signup_completed"]
    assert_equal 1, counts["first_action"]
  end
end
