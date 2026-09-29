require "test_helper"

class ProfileStatsTest < ActiveSupport::TestCase
  def make_user(name, email, role: "jobseeker")
    user = User.create!(name:, email:, password: "StrongPass123!", role:, status: "active")
    user.create_profile!
    user
  end

  test "reviews summary is nil until at least one published review exists" do
    talent = make_user("Stats Talent", "stats-talent@example.com")
    assert_nil ProfileStats.for(talent)["reviewsAverage"]
    assert_equal 0, ProfileStats.for(talent)["reviewsCount"]

    author = make_user("Stats Author", "stats-author@example.com")
    Review.create!(author:, employer: talent, rating: 4, body: "Great to work with", status: "published")
    Review.create!(author: make_user("Stats Author 2", "stats-author-2@example.com"), employer: talent, rating: 2, body: "So-so", status: "pending")

    stats = ProfileStats.for(talent)
    assert_equal 1, stats["reviewsCount"]
    assert_equal 4.0, stats["reviewsAverage"]
  end

  test "response time is nil with fewer than 3 responses in the last 90 days, and the median otherwise" do
    responder = make_user("Median Responder", "median-responder@example.com")
    requester = make_user("Median Hirer", "median-hirer@example.com", role: "employer")

    assert_nil ProfileStats.for(responder)["responseTimeMinutes"]

    [5, 15, 200].each do |minutes|
      request = UrgentRequest.create!(requester:, title: "Need someone", role_name: "Vocalist", city: "Chennai",
        currency: "INR", start_at: 1.day.from_now, status: "open")
      request.update_column(:created_at, 10.days.ago)
      request.urgent_request_responses.create!(user: responder, created_at: 10.days.ago + minutes.minutes)
    end

    assert_equal 15, ProfileStats.for(responder)["responseTimeMinutes"]
  end

  test "response time ignores responses older than 90 days" do
    responder = make_user("Stale Responder", "stale-responder@example.com")
    requester = make_user("Stale Hirer", "stale-hirer@example.com", role: "employer")

    3.times do
      request = UrgentRequest.create!(requester:, title: "Need someone", role_name: "Bassist", city: "Pune",
        currency: "INR", start_at: 1.day.from_now, status: "open")
      request.update_column(:created_at, 200.days.ago)
      request.urgent_request_responses.create!(user: responder, created_at: 200.days.ago + 10.minutes)
    end

    assert_nil ProfileStats.for(responder)["responseTimeMinutes"]
  end

  test "fastResponderBadge reflects only the current ISO week" do
    responder = make_user("Badge Responder", "badge-responder@example.com")
    assert_equal false, ProfileStats.for(responder)["fastResponderBadge"]

    Badge.create!(user_id: responder.id, kind: "fast_responder_week", awarded_for: Badge.iso_week(Time.current))
    assert_equal true, ProfileStats.for(responder)["fastResponderBadge"]
  end

  test "batch matches the per-user stats for several users at once" do
    a = make_user("Batch A", "batch-a@example.com")
    b = make_user("Batch B", "batch-b@example.com")
    Review.create!(author: b, employer: a, rating: 5, body: "Great", status: "published")
    Badge.create!(user_id: b.id, kind: "fast_responder_week", awarded_for: Badge.iso_week(Time.current))

    batch = ProfileStats.batch([a, b])
    assert_equal ProfileStats.for(a), batch[a.id]
    assert_equal ProfileStats.for(b), batch[b.id]
    assert_equal({}, ProfileStats.batch([]))
  end
end
