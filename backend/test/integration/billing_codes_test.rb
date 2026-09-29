require "test_helper"
require_relative "../support/promo_code_helpers"

# Promo, extended-trial, Early Access and referral codes, and annual plans, at checkout in the
# local "mock" billing mode (no Razorpay keys). The simulator flows are in BillingCodesSimulatorTest.
class BillingCodesTest < ActionDispatch::IntegrationTest
  include PromoCodeHelpers

  setup do
    @keys = %w[RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_SIMULATOR RAZORPAY_PLAN_PRO RAZORPAY_PLAN_STUDIO RAZORPAY_PLAN_PRO_ANNUAL RAZORPAY_PLAN_STUDIO_ANNUAL]
    @previous_env = @keys.to_h { [_1, ENV[_1]] }
    @keys.each { ENV.delete(_1) }
    @user, @token = create_person("Code Buyer")
  end

  teardown { @previous_env.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value } }

  def checkout(plan = "pro", **extra)
    post "/api/billing/checkout", params: { planCode: plan }.merge(extra), headers: bearer(@token), as: :json
  end

  def validate(code, plan: "pro", interval: "monthly", token: @token)
    post "/api/billing/codes/validate", params: { code:, planCode: plan, interval: }, headers: bearer(token), as: :json
    response.parsed_body
  end

  def summary
    get "/api/billing/subscription", headers: bearer(@token)
    response.parsed_body.fetch("summary")
  end

  # ---- validate endpoint ---------------------------------------------------------------

  test "validate needs a signed-in user" do
    post "/api/billing/codes/validate", params: { code: "X", planCode: "pro" }, as: :json
    assert_response :unauthorized
  end

  test "validate returns the effect for a good code and the messages for every refusal" do
    make_code(code: "MUMBAI50", percent_off: 50, duration_periods: nil)
    body = validate("mumbai50")
    assert_response :success
    assert_equal({ "valid" => true, "kind" => "discount_percent", "message" => "Code applied.", "reason" => nil,
                   "effect" => { "percentOff" => 50, "durationPeriods" => nil, "trialDays" => nil, "earlyAccessDays" => nil } }, body)

    make_code(code: "GONE1", expires_at: 1.hour.ago)
    make_code(code: "STUDIO1", plan_codes: ["studio"])
    used = make_code(code: "USED1")
    PromoRedemption.create!(promo_code: used, user: @user, kind: used.kind, redeemed_at: Time.current)
    mine = PromoCodes::Generator.referral_for(@user)
    {
      "GONE1" => "This code has expired.", "STUDIO1" => "This code is for the Studio plan.", "USED1" => "You've already used this code.",
      mine.code => "You can't use your own referral code.", "NOSUCH" => "That code isn't valid."
    }.each do |code, message|
      body = validate(code)
      assert_equal [false, message], body.values_at("valid", "message"), code
      assert_equal({ "percentOff" => nil, "durationPeriods" => nil, "trialDays" => nil, "earlyAccessDays" => nil }, body["effect"])
    end
    assert_equal "self_referral", validate(mine.code)["reason"]
  end

  test "validate rejects a malformed question" do
    post "/api/billing/codes/validate", params: { code: "X", planCode: "enterprise" }, headers: bearer(@token), as: :json
    assert_response :bad_request
    post "/api/billing/codes/validate", params: { code: "X", planCode: "pro", interval: "weekly" }, headers: bearer(@token), as: :json
    assert_response :bad_request
    post "/api/billing/codes/validate", params: { code: " ", planCode: "pro" }, headers: bearer(@token), as: :json
    assert_response :bad_request
  end

  test "validate is throttled" do
    original = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    31.times { validate("NOSUCH") }
    assert_response :too_many_requests
  ensure
    Rails.cache = original
  end

  # ---- checkout with each kind ---------------------------------------------------------

  test "a discount code records the percentage, uses one redemption and shows in the billing summary" do
    promo = make_code(code: "MUMBAI50", percent_off: 20, duration_periods: 2, max_redemptions: 10)
    checkout("pro", code: "mumbai50")
    assert_response :success, response.body
    sub = Subscription.find(response.parsed_body.dig("subscription", "id"))
    assert_equal [promo.id, 20, 2, 0, "monthly"], [sub.promo_code_id, sub.discount_percent, sub.discount_periods, sub.discount_periods_used, sub.interval]
    assert_equal 1, promo.reload.redemptions_count
    assert_equal sub.id, PromoRedemption.find_by!(promo_code: promo, user: @user).subscription_id

    promo_summary = summary.fetch("promo")
    assert_equal({ "code" => "MUMBAI50", "kind" => "discount_percent", "percentOff" => 20, "periodsLeft" => 2, "trialDays" => nil }, promo_summary)
    assert_equal 2499, summary["amount"]
    assert_equal 1999, summary["nextAmount"]

    sub.update!(discount_periods_used: 2)
    assert_equal 2499, PlanPricing.next_amount(sub)
  end

  test "a code that cannot be used refuses the checkout with its reason and creates nothing" do
    make_code(code: "OLDCODE", expires_at: 1.day.ago)
    checkout("pro", code: "OLDCODE")
    assert_response :unprocessable_content
    assert_equal ["This code has expired.", "PROMO_EXPIRED"], response.parsed_body.values_at("error", "code")
    assert_equal 0, Subscription.where(user: @user).count
    assert_equal 0, PromoRedemption.count
  end

  test "a plan-restricted code refuses another plan" do
    make_code(code: "PROONLY", plan_codes: ["pro"])
    checkout("studio", code: "PROONLY")
    assert_response :unprocessable_content
    assert_equal "PROMO_PLAN_MISMATCH", response.parsed_body["code"]
  end

  test "an extended-trial code overrides the trial length, even for someone who already had a trial" do
    Subscription.create!(user: @user, plan_code: "pro", provider: "internal", status: "cancelled", trial_started_at: 100.days.ago, trial_ends_at: 86.days.ago)
    checkout("pro")
    assert_equal "active", Subscription.find(response.parsed_body.dig("subscription", "id")).status, "no code, no second trial"

    promo = make_code(kind: "extended_trial", code: "TRIAL90", trial_days: 90)
    checkout("pro", code: "TRIAL90")
    assert_response :success, response.body
    sub = Subscription.find(response.parsed_body.dig("subscription", "id"))
    assert_equal "trialing", sub.status
    assert_in_delta 90.days.from_now.to_f, sub.trial_ends_at.to_f, 10
    assert_equal promo.id, sub.promo_code_id
    assert_equal 90, PromoRedemption.find_by!(promo_code: promo).trial_days
    assert_equal 90, summary.dig("promo", "trialDays")
  end

  test "an extended-trial code also lengthens a first trial" do
    make_code(kind: "extended_trial", code: "TRIAL30", trial_days: 30)
    checkout("studio", code: "TRIAL30")
    sub = Subscription.find(response.parsed_body.dig("subscription", "id"))
    assert_in_delta 30.days.from_now.to_f, sub.trial_ends_at.to_f, 10
  end

  test "an early-access code grants Early Access Pro instead of a checkout, until seats run out" do
    promo = make_code(kind: "early_access", code: "EARLYBIRD", max_redemptions: 5)
    checkout("pro", code: "EARLYBIRD")
    assert_response :success, response.body
    assert_equal "early_access", response.parsed_body.dig("checkout", "mode")
    sub = Subscription.find(response.parsed_body.dig("subscription", "id"))
    assert_equal ["early_access", true, promo.id], [sub.status, sub.early_access, sub.promo_code_id]
    assert_equal "pro", Entitlements.for(@user).plan_code
    assert_equal({ "code" => "EARLYBIRD", "kind" => "early_access", "percentOff" => nil, "periodsLeft" => nil, "trialDays" => nil }, summary["promo"])

    other, other_token = create_person("Late Buyer")
    BillingConfig.stub(:early_access_seats, 1) do
      post "/api/billing/checkout", params: { planCode: "pro", code: "EARLYBIRD" }, headers: bearer(other_token), as: :json
    end
    assert_response :unprocessable_content
    assert_equal "PROMO_SEATS_EXHAUSTED", response.parsed_body["code"]
    assert_equal 0, Subscription.where(user: other).count
  end

  test "using the same code twice is refused" do
    make_code(code: "ONEUSE")
    checkout("pro", code: "ONEUSE")
    assert_response :success
    checkout("pro", code: "ONEUSE")
    assert_response :unprocessable_content
    assert_equal "PROMO_ALREADY_USED", response.parsed_body["code"]
  end

  test "your own referral code is refused at checkout" do
    mine = PromoCodes::Generator.referral_for(@user)
    checkout("pro", code: mine.code)
    assert_response :unprocessable_content
    assert_equal "PROMO_SELF_REFERRAL", response.parsed_body["code"]
  end

  test "a referral code gives the programme discount" do
    referrer, = create_person("Referrer Person")
    promo = PromoCodes::Generator.referral_for(referrer)
    checkout("pro", code: promo.code)
    assert_response :success, response.body
    sub = Subscription.find(response.parsed_body.dig("subscription", "id"))
    assert_equal [20, 3], [sub.discount_percent, sub.discount_periods]
    assert_equal 1, promo.reload.redemptions_count
  end

  # ---- annual plans --------------------------------------------------------------------

  test "plans report both prices and whether annual is available" do
    get "/api/billing/plans"
    body = response.parsed_body
    assert_equal true, body["annualAvailable"]
    pro, studio = body["plans"].values_at(1, 2)
    assert_equal [2499, 24_990, 5999, 59_990], [pro["monthly"], pro["annual"], studio["monthly"], studio["annual"]]
    assert_equal pro["monthly"] * 10, pro["annual"]
  end

  test "an annual checkout records the interval and the summary shows the yearly amount" do
    checkout("studio", interval: "annual")
    assert_response :success, response.body
    assert_equal "annual", Subscription.find(response.parsed_body.dig("subscription", "id")).interval
    assert_equal ["annual", 59_990], summary.values_at("interval", "amount")
  end

  test "an unknown interval is a bad request" do
    checkout("pro", interval: "weekly")
    assert_response :bad_request
  end

  test "with Razorpay keys but no annual plan ids, annual checkout is 503 and the toggle is hidden" do
    ENV.update("RAZORPAY_KEY_ID" => "rzp_test_abc", "RAZORPAY_KEY_SECRET" => "secret", "RAZORPAY_PLAN_PRO" => "plan_pro", "RAZORPAY_PLAN_STUDIO" => "plan_studio")
    checkout("pro", interval: "annual")
    assert_response :service_unavailable
    assert_equal "Annual billing is not configured yet", response.parsed_body["error"]
    get "/api/billing/plans"
    assert_equal false, response.parsed_body["annualAvailable"]

    ENV["RAZORPAY_PLAN_PRO_ANNUAL"] = "plan_pro_y"
    get "/api/billing/plans"
    assert_equal false, response.parsed_body["annualAvailable"], "every paid plan needs an annual id"
    ENV["RAZORPAY_PLAN_STUDIO_ANNUAL"] = "plan_studio_y"
    get "/api/billing/plans"
    assert_equal true, response.parsed_body["annualAvailable"]
  end

  test "the monthly plan id can be RAZORPAY_PLAN_<CODE>_MONTHLY too" do
    ENV["RAZORPAY_PLAN_PRO_MONTHLY"] = "plan_m"
    assert_equal "plan_m", PlanPricing.provider_plan_id("pro", "monthly")
    ENV["RAZORPAY_PLAN_PRO"] = "plan_original"
    assert_equal "plan_original", PlanPricing.provider_plan_id("pro", "monthly")
    assert_equal [["pro", "monthly"], nil], [PlanPricing.plan_for_provider_id("plan_original"), PlanPricing.plan_for_provider_id("nope")]
  ensure
    ENV.delete("RAZORPAY_PLAN_PRO_MONTHLY")
  end

  test "annual is unavailable in production without keys" do
    Rails.stub(:env, ActiveSupport::EnvironmentInquirer.new("production")) { assert_equal false, PlanPricing.annual_available? }
    assert_equal false, PlanPricing.annual_available?("free")
  end

  test "amounts are formatted in rupees" do
    assert_equal ["₹2,499", "₹24,990", "₹999", "₹0"], [2499, 24_990, 999, 0].map { PlanPricing.format_inr(_1) }
  end

  # ---- referral code endpoint ----------------------------------------------------------

  test "the referral code is issued lazily with its share url and counters" do
    get "/api/me/referral-code", headers: bearer(@token)
    assert_response :success
    body = response.parsed_body
    assert_match(/\AVERSE-CODE[A-Z2-9]{4}\z/, body["code"])
    assert_equal "#{FrontendUrl.base}/pricing?code=#{body['code']}", body["shareUrl"]
    assert_equal [0, 0], body.values_at("redemptions", "rewardsEarned")

    get "/api/me/referral-code", headers: bearer(@token)
    assert_equal body["code"], response.parsed_body["code"]
    assert_equal 1, PromoCode.where(owner_user_id: @user.id).count

    BillingCredit.create!(user: @user, days: 30, reason: "referral_reward")
    PromoCode.find_by!(code: body["code"]).update!(redemptions_count: 2)
    get "/api/me/referral-code", headers: bearer(@token)
    assert_equal [2, 1], response.parsed_body.values_at("redemptions", "rewardsEarned")
  end

  test "the referral code is 404 when the programme is off and 401 when signed out" do
    BillingConfig.stub(:referral_enabled?, false) do
      get "/api/me/referral-code", headers: bearer(@token)
      assert_response :not_found
    end
    get "/api/me/referral-code"
    assert_response :unauthorized
  end

  # ---- reminders -----------------------------------------------------------------------

  test "the renewal reminder shows the interval, the next amount and pending referral credit" do
    include_jobs = ActiveJob::Base.queue_adapter.is_a?(ActiveJob::QueueAdapters::TestAdapter)
    skip "test queue adapter unavailable" unless include_jobs
    sub = Subscription.create!(user: @user, plan_code: "pro", interval: "annual", provider: "razorpay", status: "active", provider_subscription_id: "sub_annual_rem",
      current_period_end: (Date.current + 3).end_of_day - 1.hour, discount_percent: 20, discount_periods: 3)
    BillingCredit.create!(user: @user, days: 30, reason: "referral_reward")
    BillingRemindersJob.perform_now(Date.current)
    job = ActiveJob::Base.queue_adapter.enqueued_jobs.find { _1["job_class"] == "NotificationEmailJob" && _1["arguments"][1] == "plan_renewing_soon" }
    params = job["arguments"][2]
    assert_equal ["₹19,992", "annual", 30], params.values_at("amount", "interval", "creditDays")
    rendered = NotificationEmail.render("plan_renewing_soon", params.except("_aj_hash_with_indifferent_access"), @user)
    assert_includes rendered[:text], "annual plan renews"
    assert_includes rendered[:text], "a year"
    assert_includes rendered[:text], "30 bonus days from referrals"
    assert_equal sub.id, BillingReminder.find_by!(kind: "renewal_ending").subscription_id
  end
end
