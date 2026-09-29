require "test_helper"

class BillingCancelTokenTest < ActiveSupport::TestCase
  setup do
    @user = User.create!(name: "Cancel Token User", email: "cancel-token-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "employer", status: "active")
    @other_user = User.create!(name: "Someone Else", email: "cancel-token-other-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "employer", status: "active")
    @subscription = Subscription.create!(user: @user, plan_code: "pro", provider: "razorpay", status: "active", provider_subscription_id: "sub_token")
  end

  test "a generated token verifies for the subscription's own user" do
    token = BillingCancelToken.generate(@subscription)
    assert_equal @subscription.id, BillingCancelToken.subscription_for(token, @user)&.id
  end

  test "a token does not verify for a different user" do
    token = BillingCancelToken.generate(@subscription)
    assert_nil BillingCancelToken.subscription_for(token, @other_user)
  end

  test "garbage does not verify" do
    assert_nil BillingCancelToken.subscription_for("not-a-real-token", @user)
  end

  test "an expired token does not verify" do
    token = travel_to(15.days.ago) { BillingCancelToken.generate(@subscription) }
    assert_nil BillingCancelToken.subscription_for(token, @user)
  end
end
