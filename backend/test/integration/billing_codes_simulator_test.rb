require "test_helper"
require_relative "../support/promo_code_helpers"

# Annual plans, discounts and the referral reward against the local Razorpay simulator: the real
# gateway, signed webhooks, and the amounts Razorpay would charge.
class BillingCodesSimulatorTest < ActionDispatch::IntegrationTest
  include PromoCodeHelpers
  include ActiveJob::TestHelper

  ENV_KEYS = %w[RAZORPAY_SIMULATOR RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET RAZORPAY_PLAN_PRO RAZORPAY_PLAN_STUDIO
                RAZORPAY_PLAN_PRO_ANNUAL RAZORPAY_PLAN_STUDIO_ANNUAL RAZORPAY_REFERRAL_OFFER_ID].freeze

  setup do
    @previous_env = ENV_KEYS.to_h { [_1, ENV[_1]] }
    ENV.update("RAZORPAY_SIMULATOR" => "true", "RAZORPAY_KEY_ID" => "rzp_test_simulator", "RAZORPAY_KEY_SECRET" => "sim_secret_#{SecureRandom.hex(4)}",
               "RAZORPAY_WEBHOOK_SECRET" => "simulator-webhook-secret", "RAZORPAY_PLAN_PRO" => "plan_SimPro", "RAZORPAY_PLAN_STUDIO" => "plan_SimStudio",
               "RAZORPAY_PLAN_PRO_ANNUAL" => "plan_SimProYear", "RAZORPAY_PLAN_STUDIO_ANNUAL" => "plan_SimStudioYear")
    ENV.delete("RAZORPAY_REFERRAL_OFFER_ID")
    RazorpaySimulator.reset!
    @user, @token = create_person("Sim Buyer")
  end

  teardown do
    @previous_env.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    RazorpaySimulator.reset!
  end

  def auth(token = @token) = bearer(token)

  def start_checkout(plan, token: @token, **extra)
    post "/api/billing/checkout", params: { planCode: plan }.merge(extra), headers: auth(token).merge("Idempotency-Key" => SecureRandom.uuid), as: :json
    assert_response :success, response.body
    response.parsed_body.dig("checkout", "subscriptionId")
  end

  def deliver(webhooks)
    webhooks.each do |hook|
      hook = hook.deep_symbolize_keys
      post "/api/billing/webhook/razorpay", params: hook[:body], headers: hook[:headers].stringify_keys
      assert_response :success, response.body
    end
  end

  def pay_in_full(sub_id, token: @token)
    post "/api/dev/razorpay/checkout", params: { subscriptionId: sub_id, outcome: "success" }, headers: auth(token), as: :json
    assert_response :success, response.body
    deliver(response.parsed_body.fetch("webhooks"))
  end

  def lifecycle(sub_id, action, token: @token)
    post "/api/dev/razorpay/subscriptions/#{sub_id}/#{action}", headers: auth(token), as: :json
    assert_response :success, response.body
    deliver(response.parsed_body.fetch("webhooks"))
  end

  def charged_amounts
    get "/api/billing/subscription", headers: auth
    response.parsed_body.fetch("history").map { _1["amount"] }.reverse
  end

  test "an annual subscription is created on the annual plan and charged the yearly price for a year" do
    sub_id = start_checkout("pro", interval: "annual")
    remote = RazorpaySimulator.instance.subscription(sub_id)
    assert_equal "plan_SimProYear", remote["plan_id"]
    assert_equal "annual", remote.dig("notes", "interval")
    local = Subscription.find_by!(provider_subscription_id: sub_id)
    assert_equal "annual", local.interval

    pay_in_full(sub_id)
    travel 15.days do
      lifecycle(sub_id, "activate")
      remote = RazorpaySimulator.instance.subscription(sub_id)
      assert_equal 365 * 24 * 3600, remote["current_end"] - remote["current_start"]
      assert_equal [24_990.0], charged_amounts
      get "/api/billing/subscription", headers: auth
      assert_equal [24_990, "annual"], response.parsed_body.fetch("summary").values_at("amount", "interval")
    end
  end

  test "the studio annual price is ten months of the monthly price" do
    sub_id = start_checkout("studio", interval: "annual")
    pay_in_full(sub_id)
    travel(15.days) { lifecycle(sub_id, "activate") }
    assert_equal [59_990.0], charged_amounts
  end

  test "a discount code lowers the recorded charge for its periods only, and each charge uses one up" do
    promo = make_code(code: "MUMBAI50", percent_off: 20, duration_periods: 2, razorpay_offer_id: "offer_Sim20")
    sub_id = start_checkout("pro", code: "MUMBAI50")
    remote = RazorpaySimulator.instance.subscription(sub_id)
    assert_equal "offer_Sim20", remote["offer_id"], "the Razorpay offer id is passed when creating the subscription"
    local = Subscription.find_by!(provider_subscription_id: sub_id)
    assert_equal promo.id, local.promo_code_id

    pay_in_full(sub_id)
    travel 15.days do
      lifecycle(sub_id, "activate")
      assert_equal 1, local.reload.discount_periods_used
    end
    travel(46.days) { lifecycle(sub_id, "charge") }
    assert_equal 2, local.reload.discount_periods_used
    travel(77.days) { lifecycle(sub_id, "charge") }
    assert_equal 2, local.reload.discount_periods_used, "no more than the code's periods"
    assert_equal [1999.2, 1999.2, 2499.0], charged_amounts
  end

  test "a discount code without an offer id is applied in the simulator but refused for live billing" do
    make_code(code: "NOOFFER", percent_off: 10)
    sub_id = start_checkout("pro", code: "NOOFFER")
    assert_nil RazorpaySimulator.instance.subscription(sub_id)["offer_id"]

    ENV["RAZORPAY_SIMULATOR"] = nil
    other, other_token = create_person("Live Buyer")
    post "/api/billing/checkout", params: { planCode: "pro", code: "NOOFFER" }, headers: auth(other_token), as: :json
    assert_response :unprocessable_content
    assert_equal "PROMO_NEEDS_OFFER", response.parsed_body["code"]
    assert_equal 0, Subscription.where(user: other).count
  end

  test "a referral checkout passes the programme offer id" do
    ENV["RAZORPAY_REFERRAL_OFFER_ID"] = "offer_RefSim"
    referrer, = create_person("Referrer Person")
    code = PromoCodes::Generator.referral_for(referrer).code
    sub_id = start_checkout("pro", code:)
    assert_equal "offer_RefSim", RazorpaySimulator.instance.subscription(sub_id)["offer_id"]
  end

  test "a failed provider call gives the redemption back" do
    promo = make_code(code: "GIVEBACK", razorpay_offer_id: "offer_x")
    RazorpaySimulator.instance.inject_fault(:create_subscription, :bad_request)
    post "/api/billing/checkout", params: { planCode: "pro", code: "GIVEBACK" }, headers: auth.merge("Idempotency-Key" => SecureRandom.uuid), as: :json
    assert_response :bad_gateway
    assert_equal 0, promo.reload.redemptions_count
    assert_equal 0, PromoRedemption.count
    assert_equal "cancelled", Subscription.find_by!(user: @user).status
  end

  # ---- referral reward on the referee's first payment ----------------------------------

  def referee_pays_first_charge(code)
    referee, referee_token = create_person("Referred Hirer")
    sub_id = start_checkout("pro", token: referee_token, code:)
    pay_in_full(sub_id, token: referee_token)
    travel(15.days) { lifecycle(sub_id, "activate", token: referee_token) }
    [referee, sub_id, referee_token]
  end

  test "the referrer earns reward days on their Early Access subscription when the referee first pays, once" do
    referrer, = create_person("Referrer Person")
    early = Subscription.create!(user: referrer, plan_code: "pro", provider: "internal", status: "early_access", early_access: true, trial_started_at: Time.current, trial_ends_at: 60.days.from_now)
    original_end = early.trial_ends_at
    code = PromoCodes::Generator.referral_for(referrer).code

    referee, sub_id, referee_token = referee_pays_first_charge(code)
    assert_in_delta (original_end + 30.days).to_f, early.reload.trial_ends_at.to_f, 1
    credit = BillingCredit.find_by!(user: referrer)
    assert_equal [30, "referral_reward"], [credit.days, credit.reason]
    assert_not_nil credit.applied_at
    redemption = PromoRedemption.find_by!(user: referee)
    assert_not_nil redemption.referrer_rewarded_at
    assert_equal credit.id, redemption.billing_credit.id

    travel(46.days) { lifecycle(sub_id, "charge", token: referee_token) }
    assert_equal 1, BillingCredit.where(user: referrer).count, "only the first payment rewards"

    get "/api/me/referral-code", headers: auth(create_referrer_token(referrer))
    assert_equal [1, 1], response.parsed_body.values_at("redemptions", "rewardsEarned")
  end

  def create_referrer_token(user)
    token = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(token), expires_at: 1.year.from_now)
    token
  end

  test "an internal active subscription gets its period end extended" do
    referrer, = create_person("Referrer Person")
    active = Subscription.create!(user: referrer, plan_code: "pro", provider: "internal", status: "active", current_period_start: Time.current, current_period_end: 20.days.from_now)
    before = active.current_period_end
    referee_pays_first_charge(PromoCodes::Generator.referral_for(referrer).code)
    assert_in_delta (before + 30.days).to_f, active.reload.current_period_end.to_f, 1
  end

  test "a live Razorpay referrer gets an unapplied credit and Razorpay is left alone" do
    referrer, = create_person("Referrer Person")
    live = Subscription.create!(user: referrer, plan_code: "pro", provider: "razorpay", status: "active", provider_subscription_id: "sub_live_referrer", current_period_end: 20.days.from_now)
    before = live.current_period_end
    referee_pays_first_charge(PromoCodes::Generator.referral_for(referrer).code)
    credit = BillingCredit.find_by!(user: referrer)
    assert_nil credit.applied_at
    assert_equal before.to_i, live.reload.current_period_end.to_i

    live.update!(current_period_end: (Date.current + 3).end_of_day - 1.hour)
    BillingRemindersJob.perform_now(Date.current)
    job = enqueued_jobs.find { _1["job_class"] == "NotificationEmailJob" && _1["arguments"][0] == referrer.id }
    assert_equal 30, job["arguments"][2]["creditDays"]
  end

  test "a referrer with no subscription still has the reward recorded as a credit" do
    referrer, = create_person("Referrer Person")
    referee_pays_first_charge(PromoCodes::Generator.referral_for(referrer).code)
    assert_nil BillingCredit.find_by!(user: referrer).applied_at
  end

  test "rewards stop at the cap" do
    referrer, = create_person("Referrer Person")
    BillingConfig.referral.fetch(:referrer_reward_cap).times { BillingCredit.create!(user: referrer, days: 30, reason: "referral_reward") }
    referee, = referee_pays_first_charge(PromoCodes::Generator.referral_for(referrer).code)
    assert_equal BillingConfig.referral.fetch(:referrer_reward_cap), BillingCredit.where(user: referrer).count
    assert_not_nil PromoRedemption.find_by!(user: referee).referrer_rewarded_at, "the redemption is settled, not retried forever"
  end

  test "checking out with your own referral code is refused and no reward is possible" do
    mine = PromoCodes::Generator.referral_for(@user)
    post "/api/billing/checkout", params: { planCode: "pro", code: mine.code }, headers: auth, as: :json
    assert_response :unprocessable_content
    assert_equal "PROMO_SELF_REFERRAL", response.parsed_body["code"]

    forged = PromoRedemption.create!(promo_code: mine, user: @user, kind: "referral", redeemed_at: Time.current)
    assert_nil PromoCodes::ReferralReward.call(forged)
    assert_equal 0, BillingCredit.count
  end
end
