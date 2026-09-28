require "test_helper"

class AiBillingTest < ActionDispatch::IntegrationTest
  setup do
    @user = User.create!(name: "Topup User", email: "topup-user@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", email_verified: true)
    @token = session_for(@user)
  end

  test "topup purchase routes answer 503 while AI_BILLING_ENABLED is off" do
    post "/api/ai/topups", params: { pack: "small" }, headers: auth(@token), as: :json
    assert_response :service_unavailable
    assert_equal "AI_BILLING_DISABLED", response.parsed_body["code"]
  end

  test "with billing enabled and no Razorpay keys, a topup is credited immediately in mock mode" do
    with_env("AI_BILLING_ENABLED" => "true", "RAZORPAY_KEY_ID" => nil, "RAZORPAY_KEY_SECRET" => nil) do
      post "/api/ai/topups", params: { pack: "small" }, headers: auth(@token), as: :json
      assert_response :success
      payment = AiTopupPayment.find(response.parsed_body.dig("payment", "id"))
      assert_equal "paid", payment.status
      resolution = AiCreditAccount.for(@user)
      assert_equal 150, AiCredits.balance(resolution.account_type, resolution.account_id)
    end
  end

  test "crediting a top-up payment twice never double-credits (idempotent per payment)" do
    with_env("AI_BILLING_ENABLED" => "true") do
      payment = AiTopupPayment.create!(user: @user, pack: "large", amount: 399, credits: 700, provider: "internal", status: "created")
      assert_equal :credited, payment.credit!
      assert_equal :already_paid, payment.credit!
      resolution = AiCreditAccount.for(@user)
      assert_equal 700, AiCredits.balance(resolution.account_type, resolution.account_id)
    end
  end

  test "ai/plus/subscribe answers 503 while AI_BILLING_ENABLED is off" do
    post "/api/ai/plus/subscribe", headers: auth(@token)
    assert_response :service_unavailable
  end

  test "with billing enabled and no Razorpay keys, ai/plus/subscribe creates a mock active subscription" do
    with_env("AI_BILLING_ENABLED" => "true", "RAZORPAY_KEY_ID" => nil, "RAZORPAY_KEY_SECRET" => nil) do
      post "/api/ai/plus/subscribe", headers: auth(@token)
      assert_response :success
      assert Subscription.exists?(user: @user, plan_code: "ai_plus", status: "active")
    end
  end

  private

  def with_env(values)
    previous = values.keys.to_h { [_1, ENV[_1]] }
    values.each { |k, v| v.nil? ? ENV.delete(k) : ENV[k] = v }
    yield
  ensure
    previous.each { |k, v| v.nil? ? ENV.delete(k) : ENV[k] = v }
  end

  def auth(token) = { "Authorization" => "Bearer #{token}" }

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    raw
  end
end
