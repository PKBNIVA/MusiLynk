require "test_helper"

class EntitlementsEarlyAccessTest < ActiveSupport::TestCase
  setup do
    @user = User.create!(name: "Early Access Hirer", email: "early-access-#{SecureRandom.hex(5)}@example.com",
      password: "StrongPass123!", role: "employer", status: "active")
    @user.create_profile!(company_name: "Early Access Co")
  end

  test "an early_access subscription grants Pro limits while trial_ends_at is in the future" do
    Subscription.create!(user: @user, plan_code: "pro", provider: "internal", status: "early_access",
      early_access: true, trial_started_at: Time.current, trial_ends_at: 90.days.from_now)

    entitlements = Entitlements.for(@user)
    assert_equal "pro", entitlements.plan_code
    assert_equal Billing::BillingController::PLANS.dig("pro", :bookings), entitlements.limit(:bookings)
  end

  test "an early_access subscription grants nothing once trial_ends_at has passed" do
    Subscription.create!(user: @user, plan_code: "pro", provider: "internal", status: "early_access",
      early_access: true, trial_started_at: 91.days.ago, trial_ends_at: 1.minute.ago)

    assert_equal "free", Entitlements.for(@user).plan_code
  end

  test "a revoked (cancelled) early access grant no longer grants anything even before its end date" do
    Subscription.create!(user: @user, plan_code: "pro", provider: "internal", status: "cancelled",
      early_access: true, trial_started_at: Time.current, trial_ends_at: 90.days.from_now)

    assert_equal "free", Entitlements.for(@user).plan_code
  end
end
