require "test_helper"

class BillingEarlyAccessTest < ActionDispatch::IntegrationTest
  setup do
    @user, @token = create_user("Early Access Billing", "employer")
  end

  test "billing summary reports earlyAccess.until while an early_access subscription is active" do
    sub = Subscription.create!(user: @user, plan_code: "pro", provider: "internal", status: "early_access",
      early_access: true, trial_started_at: Time.current, trial_ends_at: 90.days.from_now)

    get "/api/billing/subscription", headers: auth
    assert_response :success
    body = response.parsed_body
    assert_equal "pro", body.dig("summary", "planCode")
    assert_equal "early_access", body.dig("summary", "status")
    assert_not_nil body.dig("summary", "earlyAccess", "until")
    assert_equal sub.trial_ends_at.as_json, body.dig("summary", "earlyAccess", "until")
  end

  test "billing summary has no earlyAccess key for a plain paid subscription" do
    Subscription.create!(user: @user, plan_code: "pro", provider: "razorpay", status: "active", provider_subscription_id: "sub_plain")

    get "/api/billing/subscription", headers: auth
    assert_nil response.parsed_body.dig("summary", "earlyAccess")
  end

  test "verify-cancel-link accepts a valid token for the signed-in user and rejects everything else" do
    sub = Subscription.create!(user: @user, plan_code: "pro", provider: "razorpay", status: "active", provider_subscription_id: "sub_cancel_link")
    token = BillingCancelToken.generate(sub)

    get "/api/billing/cancel-link", params: { t: token }, headers: auth
    assert_response :success
    assert_equal sub.id, response.parsed_body["subscriptionId"]

    get "/api/billing/cancel-link", params: { t: "garbage" }, headers: auth
    assert_response :not_found

    other, other_token = create_user("Someone Else Billing", "employer")
    get "/api/billing/cancel-link", params: { t: token }, headers: { "Authorization" => "Bearer #{other_token}" }
    assert_response :not_found
  end

  private

  def auth = { "Authorization" => "Bearer #{@token}" }

  def create_user(name, role)
    user = User.create!(name:, email: "#{role}-#{SecureRandom.hex(5)}@example.com", password: "StrongPass123!", role:, status: "active")
    user.create_profile!
    token = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(token), expires_at: 1.day.from_now)
    [user, token]
  end
end
