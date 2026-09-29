require "test_helper"
require "minitest/mock"

class UrgentMatcherTest < ActiveSupport::TestCase
  setup do
    @hirer = create_user("Hirer", "matcher-hirer@example.com", "employer")
    @request = UrgentRequest.create!(requester: @hirer, title: "Drummer needed tonight", role_name: "Drummer",
      city: "Mumbai", start_at: 6.hours.from_now, end_at: 9.hours.from_now, currency: "INR", status: "open")
  end

  test "ranks a same-city, matching-role, verified candidate above an unrelated one" do
    match = create_musician("Match", city: "Mumbai", roles: ["Drummer"], verified: true)
    unrelated = create_musician("Unrelated", city: "Delhi", roles: ["Vocalist"], verified: false)

    ranked = UrgentMatcher.call(@request)
    ids = ranked.map { _1.user.id }
    assert_includes ids, match.id
    assert ids.index(match.id) < (ids.index(unrelated.id) || ids.size), "matching candidate should rank first"
  end

  test "excludes the requester even when their own profile would otherwise match" do
    @hirer.create_profile!(headline: "Also a drummer", location: "Mumbai", roles: ["Drummer"])
    assert_not_includes UrgentMatcher.call(@request).map { _1.user.id }, @hirer.id
  end

  test "excludes a candidate whose availability window blocks the request's time" do
    candidate = create_musician("Blocked", city: "Mumbai", roles: ["Drummer"])
    AvailabilityWindow.create!(user: candidate, start_at: 5.hours.from_now, end_at: 10.hours.from_now, status: "unavailable")

    assert_not_includes UrgentMatcher.call(@request).map { _1.user.id }, candidate.id
  end

  test "does not exclude a candidate whose blocked window does not overlap the request" do
    candidate = create_musician("Free later", city: "Mumbai", roles: ["Drummer"])
    AvailabilityWindow.create!(user: candidate, start_at: 2.days.from_now, end_at: 2.days.from_now + 2.hours, status: "unavailable")

    assert_includes UrgentMatcher.call(@request).map { _1.user.id }, candidate.id
  end

  test "limits ranked candidates to the configured cap" do
    UrgentConfig.stub(:candidate_limit, 2) do
      3.times { |i| create_musician("Cand#{i}", city: "Mumbai", roles: ["Drummer"]) }
      assert_equal 2, UrgentMatcher.call(@request).size
    end
  end

  test "notify! sends in-app + email to the top N and records who was notified" do
    a = create_musician("Aria", city: "Mumbai", roles: ["Drummer"])
    b = create_musician("Bo", city: "Mumbai", roles: ["Drummer"])

    notified = UrgentMatcher.notify!(@request)
    assert_equal [a.id, b.id].sort, notified.map(&:id).sort

    assert_equal 2, UrgentRequestNotification.where(urgent_request: @request, channel: "in_app").count
    assert_equal 2, Notification.where(kind: "urgent_alert").count
    assert_equal 2, @request.reload.notified_count
    assert_not_nil @request.first_notified_at
  end

  test "notify! is idempotent: a second call does not re-notify or double the count" do
    create_musician("Aria", city: "Mumbai", roles: ["Drummer"])
    UrgentMatcher.notify!(@request)
    first_count = @request.reload.notified_count

    second = UrgentMatcher.notify!(@request)
    assert_equal [], second
    assert_equal first_count, @request.reload.notified_count
    assert_equal 1, UrgentRequestNotification.where(urgent_request: @request, channel: "in_app").count
  end

  test "notify! with only_user_ids notifies exactly that candidate and records the admin who sent it" do
    admin = create_user("Admin", "matcher-admin@example.com", "admin")
    candidate = create_musician("Direct", city: "Delhi", roles: ["Vocalist"])

    notified = UrgentMatcher.notify!(@request, actor_admin: admin, only_user_ids: [candidate.id])
    assert_equal [candidate.id], notified.map(&:id)
    record = UrgentRequestNotification.find_by(urgent_request: @request, user: candidate, channel: "in_app")
    assert_equal admin.id, record.notified_by_admin_id
  end

  test "score reasons match the scoring inputs: role, city and verified" do
    candidate = create_musician("Reasoned", city: "Mumbai", roles: ["Drummer"], verified: true)
    ranked = UrgentMatcher.call(@request)
    match = ranked.find { _1.user.id == candidate.id }
    assert_equal ["Plays Drummer", "In Mumbai", "Verified"], match.reasons
  end

  test "recent activity reason appears only when the candidate was recently active" do
    candidate = create_musician("Active", city: "Mumbai", roles: ["Drummer"])
    Session.create!(user: candidate, token_digest: SecureRandom.hex(20), last_seen_at: 1.day.ago, expires_at: 1.day.from_now)
    match = UrgentMatcher.call(@request).find { _1.user.id == candidate.id }
    assert_includes match.reasons, "Active in the last 30 days"
  end

  test "notify! persists the reasons on the notification row" do
    create_musician("Aria", city: "Mumbai", roles: ["Drummer"], verified: true)
    UrgentMatcher.notify!(@request)
    record = UrgentRequestNotification.find_by(urgent_request: @request, channel: "in_app")
    assert_includes record.reasons, "Plays Drummer"
  end

  private

  def create_user(name, email, role)
    User.create!(name:, email:, password: "StrongPass123!", role:, status: "active", email_verified: true, profile_complete: true)
  end

  def create_musician(name, city:, roles:, verified: false)
    user = create_user(name, "matcher-#{name.parameterize}-#{SecureRandom.hex(3)}@example.com", "jobseeker")
    user.create_profile!(headline: name, location: city, roles:, verified:)
    user
  end
end
