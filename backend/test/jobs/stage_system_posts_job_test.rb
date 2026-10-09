require "test_helper"

# The job processes the hour ending at `run_at.beginning_of_hour` (see StageSystemPostsJob):
# fixtures set their updated_at just before that boundary, and the job is invoked with a
# `run_at` a little after it — the way the hourly cron actually fires.
class StageSystemPostsJobTest < ActiveJob::TestCase
  test "posts a welcome for a musician who just completed their profile, once, even if run twice" do
    run_at = Time.current.change(usec: 0).beginning_of_hour
    user = User.create!(name: "Asha Rao", email: "asha-welcome@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    user.create_profile!(roles: ["Drummer"], location: "Pune")
    user.update!(profile_complete: true)
    user.update_column(:updated_at, run_at - 10.minutes)

    2.times { StageSystemPostsJob.perform_now(run_at + 1.minute) }

    posts = Post.where(system_kind: "welcome", system_ref: "welcome:#{user.id}")
    assert_equal 1, posts.count
    assert_includes posts.first.body, "Asha"
    assert_includes posts.first.body, "Drummer"
    assert_includes posts.first.body, "Pune"
    assert_equal "system", posts.first.author_type
    assert_equal Post::SYSTEM_AUTHOR_ID, posts.first.author_id
    assert_nil posts.first.created_by_user_id
  end

  test "aggregates more than five completions in the same hour into one post" do
    run_at = Time.current.change(usec: 0).beginning_of_hour
    users = 6.times.map do |i|
      user = User.create!(name: "Musician #{i}", email: "musician-agg-#{i}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
      user.create_profile!(roles: ["Vocalist"])
      user.update!(profile_complete: true)
      user.update_column(:updated_at, run_at - 5.minutes)
      user
    end

    StageSystemPostsJob.perform_now(run_at + 1.minute)

    assert_equal 0, Post.where(system_kind: "welcome").count
    aggregate = Post.where(system_kind: "welcome_aggregate").sole
    assert_includes aggregate.body, "6 musicians joined"
    users.each { assert_not Post.exists?(system_ref: "welcome:#{_1.id}") }
  end

  test "posts a verified announcement only when the musician consented to sharing it" do
    run_at = Time.current.change(usec: 0).beginning_of_hour
    consenting = User.create!(name: "Consenting Musician", email: "consenting@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    consenting.create_profile!(verified: true, share_verification_publicly: true)
    consenting.profile.update_column(:updated_at, run_at - 5.minutes)

    declining = User.create!(name: "Private Musician", email: "declining@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    declining.create_profile!(verified: true, share_verification_publicly: false)
    declining.profile.update_column(:updated_at, run_at - 5.minutes)

    StageSystemPostsJob.perform_now(run_at + 1.minute)

    assert Post.exists?(system_ref: "verified:#{consenting.id}")
    assert_not Post.exists?(system_ref: "verified:#{declining.id}")
  end

  test "posts an urgent fill without naming the hirer" do
    run_at = Time.current.change(usec: 0).beginning_of_hour
    requester = User.create!(name: "Hiring Person", email: "hirer-fill@example.com", password: "StrongPass123!", role: "employer", status: "active")
    filled_by = User.create!(name: "Session Player", email: "player-fill@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    request = UrgentRequest.create!(requester:, title: "Need a bassist tonight", role_name: "Bassist", city: "Mumbai",
      currency: "INR", start_at: 2.hours.from_now, status: "open")
    request.update_columns(created_at: run_at - 3.hours, updated_at: run_at - 5.minutes, status: "filled", filled_by_id: filled_by.id)

    StageSystemPostsJob.perform_now(run_at + 1.minute)

    post = Post.find_by(system_ref: "urgent_filled:#{request.id}")
    assert post
    assert_includes post.body, "Bassist"
    assert_includes post.body, "Mumbai"
    assert_includes post.body, "3 hours"
    assert_not_includes post.body, requester.name
    assert_not_includes post.body, filled_by.name
  end

  test "posts and pins the weekly roundup only on Monday 10:00 IST, and only once" do
    monday_ten_ist = ActiveSupport::TimeZone["Asia/Kolkata"].parse("2026-09-28 10:15")

    # Post#pinned? compares pinned_until with Time.current, and the pin lasts six days past the
    # fixed Monday above, so the clock has to sit at that Monday too (unfrozen, this assertion
    # started failing on 5 Oct 2026 regardless of the Ruby version).
    travel_to monday_ten_ist do
      StageSystemPostsJob.perform_now(monday_ten_ist)
      StageSystemPostsJob.perform_now(monday_ten_ist + 5.minutes)

      posts = Post.where(system_kind: "weekly_roundup")
      assert_equal 1, posts.count
      post = posts.first
      assert post.pinned?
      assert_includes post.body, "Comment with your roles"

      not_monday_ten = ActiveSupport::TimeZone["Asia/Kolkata"].parse("2026-09-29 10:15")
      StageSystemPostsJob.perform_now(not_monday_ten)
      assert_equal 1, Post.where(system_kind: "weekly_roundup").count
    end
  end
end
