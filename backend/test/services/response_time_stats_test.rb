require "test_helper"

class ResponseTimeStatsTest < ActiveSupport::TestCase
  setup do
    @seq = 0
    @requester = create_user("employer")
  end

  test "median_minutes is nil with no data, and the median of first-response deltas otherwise" do
    assert_nil ResponseTimeStats.median_minutes

    fast = create_request(city: "Mumbai", created_at: 2.hours.ago)
    respond(fast, minutes_after: 10)
    slow = create_request(city: "Mumbai", created_at: 3.hours.ago)
    respond(slow, minutes_after: 50)

    assert_equal 30.0, ResponseTimeStats.median_minutes(city: "Mumbai")
  end

  test "median_minutes filters by city" do
    mumbai = create_request(city: "Mumbai", created_at: 1.hour.ago)
    respond(mumbai, minutes_after: 5)
    pune = create_request(city: "Pune", created_at: 1.hour.ago)
    respond(pune, minutes_after: 100)

    assert_equal 5.0, ResponseTimeStats.median_minutes(city: "Mumbai")
    assert_equal 100.0, ResponseTimeStats.median_minutes(city: "Pune")
  end

  test "median_hours converts and rounds" do
    request = create_request(city: "Delhi", created_at: 1.hour.ago)
    respond(request, minutes_after: 90)
    assert_equal 1.5, ResponseTimeStats.median_hours(city: "Delhi")
  end

  test "fastest_responders ranks by each responder's own median, fastest first" do
    fast_responder = create_user("jobseeker")
    slow_responder = create_user("jobseeker")

    r1 = create_request(city: "Goa", created_at: 1.hour.ago)
    respond(r1, minutes_after: 5, user: fast_responder)
    r2 = create_request(city: "Goa", created_at: 1.hour.ago)
    respond(r2, minutes_after: 60, user: slow_responder)

    ranked = ResponseTimeStats.fastest_responders(city: "Goa")
    assert_equal [fast_responder.id, slow_responder.id], ranked.map(&:first)
  end

  private

  def create_user(role)
    @seq += 1
    User.create!(name: "RTS User #{@seq}", email: "rts-#{@seq}-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role:, status: "active")
  end

  def create_request(city:, created_at:)
    UrgentRequest.create!(requester: @requester, title: "Need a bassist", role_name: "Bassist", city:,
      currency: "INR", status: "open", start_at: 1.day.from_now).tap { _1.update_column(:created_at, created_at) }
  end

  def respond(request, minutes_after:, user: nil)
    user ||= create_user("jobseeker")
    UrgentRequestResponse.create!(urgent_request: request, user:, status: "available",
      created_at: request.created_at + minutes_after.minutes)
  end
end
