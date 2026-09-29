require "test_helper"

class LifecycleEmailTest < ActiveSupport::TestCase
  setup do
    @user = User.create!(name: "Lifecycle User", email: "lifecycle-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "jobseeker", status: "active")
  end

  test "record! is true the first time and false for every later call with the same key" do
    assert LifecycleEmail.record!(@user, "musician_day1_first_link")
    assert_not LifecycleEmail.record!(@user, "musician_day1_first_link")
    assert_equal 1, LifecycleEmail.where(user: @user, key: "musician_day1_first_link").count
  end

  test "record! is per (user, key): a different key or user is independent" do
    other = User.create!(name: "Other", email: "lifecycle-other-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "jobseeker", status: "active")
    assert LifecycleEmail.record!(@user, "musician_day1_first_link")
    assert LifecycleEmail.record!(@user, "musician_day3_verified_badge")
    assert LifecycleEmail.record!(other, "musician_day1_first_link")
  end

  test "sent? reflects record! without creating a row" do
    assert_not LifecycleEmail.sent?(@user, "musician_day1_first_link")
    LifecycleEmail.record!(@user, "musician_day1_first_link")
    assert LifecycleEmail.sent?(@user, "musician_day1_first_link")
  end

  test "digest_key is stable within an ISO week and differs across weeks" do
    monday = Time.zone.parse("2026-09-28") # a Monday
    sunday = Time.zone.parse("2026-10-04") # end of the same ISO week
    next_monday = Time.zone.parse("2026-10-05")
    assert_equal LifecycleEmail.digest_key(monday), LifecycleEmail.digest_key(sunday)
    assert_not_equal LifecycleEmail.digest_key(monday), LifecycleEmail.digest_key(next_monday)
  end

  test "record! races safely under a duplicate key (unique index, not a prior SELECT)" do
    LifecycleEmail.create!(user: @user, key: "musician_day1_first_link", sent_at: Time.current)
    assert_not LifecycleEmail.record!(@user, "musician_day1_first_link")
  end
end
