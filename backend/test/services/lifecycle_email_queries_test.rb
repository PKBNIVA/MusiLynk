require "test_helper"

class LifecycleEmailQueriesTest < ActiveSupport::TestCase
  test "sent_by_key counts within the window, and opt_out_rates reflects preferences" do
    a = create_user
    b = create_user
    c = create_user
    LifecycleEmail.record!(a, "musician_day1_first_link")
    LifecycleEmail.record!(b, "musician_day1_first_link")
    LifecycleEmail.record!(a, "musician_day3_verified_badge")
    LifecycleEmail.where(user: a, key: "musician_day3_verified_badge").update_all(sent_at: 40.days.ago)

    b.profile.update!(email_preferences: b.profile.email_preferences.merge("digest" => false))
    c.profile.update!(email_notifications: false)

    summary = LifecycleEmailQueries.summary(days: 30)
    counts = summary[:sentByKey].index_by { _1[:key] }
    assert_equal 2, counts["musician_day1_first_link"][:count]
    assert_nil counts["musician_day3_verified_badge"]

    rates = summary[:optOutRates]
    assert_in_delta(100.0 / 3, rates[:masterOff], 0.1) # c, of 3 profiles
    assert_in_delta 50.0, rates[:categories]["digest"], 0.1 # b, of the 2 with the master switch on
    assert_equal 0.0, rates[:categories]["lifecycle"]
  end

  private

  def create_user
    User.create!(name: "Emails Admin User", email: "emails-admin-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "jobseeker", status: "active").tap { _1.create_profile! }
  end
end
