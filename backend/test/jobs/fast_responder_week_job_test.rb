require "test_helper"

class FastResponderWeekJobTest < ActiveJob::TestCase
  def make_user(name, email)
    user = User.create!(name:, email:, password: "StrongPass123!", role: "jobseeker", status: "active")
    user.create_profile!
    user
  end

  test "awards badges to the fastest responders per city with at least 2 responses, and posts the leaderboard" do
    week_start = Time.current.beginning_of_week(:monday) - 1.week
    requester = User.create!(name: "City Hirer", email: "city-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active")

    fast = make_user("Fast Responder", "fast-responder@example.com")
    slow = make_user("Slow Responder", "slow-responder@example.com")
    one_off = make_user("One Off Responder", "one-off-responder@example.com")

    2.times do |i|
      request = UrgentRequest.create!(requester:, title: "Need someone", role_name: "Guitarist", city: "Mumbai",
        currency: "INR", start_at: 1.day.from_now, status: "open")
      request.update_columns(created_at: week_start + 1.day)
      request.urgent_request_responses.create!(user: fast, created_at: week_start + 1.day + (2 + i).minutes)
      request.urgent_request_responses.create!(user: slow, created_at: week_start + 1.day + (40 + i).minutes)
    end
    # Only one response this week: excluded (needs at least 2).
    lone_request = UrgentRequest.create!(requester:, title: "Need someone else", role_name: "Bassist", city: "Mumbai",
      currency: "INR", start_at: 1.day.from_now, status: "open")
    lone_request.update_column(:created_at, week_start + 1.day)
    lone_request.urgent_request_responses.create!(user: one_off, created_at: week_start + 1.day + 3.minutes)

    FastResponderWeekJob.perform_now(week_start + 1.week + 1.hour)

    awarded_for = Badge.iso_week(week_start)
    assert Badge.exists?(user_id: fast.id, kind: "fast_responder_week", awarded_for:)
    assert Badge.exists?(user_id: slow.id, kind: "fast_responder_week", awarded_for:)
    assert_not Badge.exists?(user_id: one_off.id, kind: "fast_responder_week")

    post = Post.find_by(system_kind: "fastest_responders", city: "Mumbai")
    assert post
    assert_includes post.body, "Mumbai"
    assert_includes post.body, "Fast Responder"
    # The faster of the two badged responders is named first.
    assert_operator post.body.index("Fast Responder"), :<, post.body.index("Slow Responder")
  end

  test "is idempotent: running the same week twice does not duplicate badges or posts" do
    week_start = Time.current.beginning_of_week(:monday) - 1.week
    requester = User.create!(name: "Repeat Hirer", email: "repeat-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active")
    responder = make_user("Repeat Responder", "repeat-responder@example.com")
    2.times do |i|
      request = UrgentRequest.create!(requester:, title: "Need someone", role_name: "Drummer", city: "Pune",
        currency: "INR", start_at: 1.day.from_now, status: "open")
      request.update_column(:created_at, week_start + 1.day)
      request.urgent_request_responses.create!(user: responder, created_at: week_start + 1.day + i.minutes)
    end

    2.times { FastResponderWeekJob.perform_now(week_start + 1.week + 1.hour) }

    assert_equal 1, Badge.where(user_id: responder.id, kind: "fast_responder_week").count
    assert_equal 1, Post.where(system_kind: "fastest_responders", city: "Pune").count
  end
end
