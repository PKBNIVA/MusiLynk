require "test_helper"

class FunnelQueriesTest < ActiveSupport::TestCase
  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown do
    Rails.cache = @original_cache
  end

  test "funnel counts distinct anon_ids per step within the window" do
    ProductEvent.insert_all([
      { id: "prod_1", anon_id: "a1", name: "landing_view", props: {}, created_at: 1.day.ago },
      { id: "prod_2", anon_id: "a2", name: "landing_view", props: {}, created_at: 1.day.ago },
      { id: "prod_3", anon_id: "a1", name: "path_chosen", props: {}, created_at: 1.day.ago },
      { id: "prod_4", anon_id: "a1", name: "job_posted", props: {}, created_at: 1.day.ago },
      { id: "prod_5", anon_id: "a1", name: "booking_quote_accepted", props: {}, created_at: 1.day.ago },
      { id: "prod_6", anon_id: "a9", name: "landing_view", props: {}, created_at: 40.days.ago }
    ])

    result = FunnelQueries.summary(days: 7)
    steps = result.fetch(:funnel).to_h { |s| [s.fetch(:step), s.fetch(:count)] }
    assert_equal 2, steps.fetch("landing_view")
    assert_equal 1, steps.fetch("path_chosen")
    assert_equal 1, steps.fetch("first_action")
    assert_equal 1, steps.fetch("booking_or_urgent_filled")
  end

  test "median_first_response_minutes computes the median over requests with a response" do
    requester = User.create!(name: "Funnel Requester", email: "funnel-req-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "employer", status: "active")
    responder = User.create!(name: "Funnel Responder", email: "funnel-resp-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")

    fast = UrgentRequest.create!(requester:, title: "Fast", role_name: "Drummer", city: "Pune", currency: "INR", status: "open", start_at: 2.days.from_now, created_at: 2.hours.ago)
    slow = UrgentRequest.create!(requester:, title: "Slow", role_name: "Bassist", city: "Pune", currency: "INR", status: "open", start_at: 2.days.from_now, created_at: 2.hours.ago)
    UrgentRequestResponse.create!(urgent_request: fast, user: responder, created_at: fast.created_at + 10.minutes)
    UrgentRequestResponse.create!(urgent_request: slow, user: responder, created_at: slow.created_at + 50.minutes)

    median = FunnelQueries.median_first_response_minutes(7.days.ago)
    assert_equal 30.0, median
  end

  test "median_first_response_minutes is nil when nothing has responded yet" do
    assert_nil FunnelQueries.median_first_response_minutes(7.days.ago)
  end

  test "summary caches its result for the window" do
    first = FunnelQueries.summary(days: 7)
    ProductEvent.insert_all([{ id: "prod_cache", anon_id: "cache", name: "landing_view", props: {}, created_at: Time.current }])
    cached = FunnelQueries.summary(days: 7)
    assert_equal first, cached
  end
end
