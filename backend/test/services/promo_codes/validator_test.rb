require "test_helper"
require_relative "../../support/promo_code_helpers"

class PromoCodesValidatorTest < ActiveSupport::TestCase
  include PromoCodeHelpers

  setup { @user, = create_person("Validator Buyer") }

  def check(code, plan: "pro", interval: "monthly", user: @user) = PromoCodes::Validator.call(code:, user:, plan_code: plan, interval:)

  test "a good discount code is valid, case and space insensitive, with its effect" do
    make_code(code: "GOOD20")
    result = check("  good20 ")
    assert result.valid?
    assert_equal "discount_percent", result.kind
    assert_equal({ percentOff: 20, durationPeriods: 2, trialDays: nil, earlyAccessDays: nil }, result.effect)
  end

  test "a code issued before the MusiLynk rename (VERSE- prefix) still validates" do
    make_code(code: "VERSE-K7M2QP")
    result = check(" verse-k7m2qp ")
    assert result.valid?
    assert_equal "discount_percent", result.kind
  end

  test "extended trial and early access effects" do
    make_code(kind: "extended_trial", code: "TRIAL90")
    make_code(kind: "early_access", code: "EARLY1")
    assert_equal 90, check("TRIAL90").effect[:trialDays]
    assert_equal BillingConfig.early_access_days, check("EARLY1").effect[:earlyAccessDays]
  end

  test "unknown and blank" do
    assert_equal :unknown, check("NOPE").reason
    assert_equal :unknown, check("").reason
    assert_equal "That code isn't valid.", check(nil).message
  end

  test "inactive, not started, expired" do
    make_code(code: "OFF", active: false)
    make_code(code: "SOON", starts_at: 1.day.from_now)
    make_code(code: "OLD", expires_at: 1.minute.ago)
    assert_equal :inactive, check("OFF").reason
    assert_equal :not_started, check("SOON").reason
    assert_equal :expired, check("OLD").reason
    assert_equal "This code has expired.", check("OLD").message
  end

  test "exhausted" do
    make_code(code: "FULL", max_redemptions: 1, redemptions_count: 1)
    assert_equal :exhausted, check("FULL").reason
  end

  test "already used honours per_user_limit" do
    once = make_code(code: "ONCE")
    twice = make_code(code: "TWICE", per_user_limit: 2)
    PromoRedemption.create!(promo_code: once, user: @user, kind: once.kind, redeemed_at: Time.current)
    PromoRedemption.create!(promo_code: twice, user: @user, kind: twice.kind, redeemed_at: Time.current)
    assert_equal :already_used, check("ONCE").reason
    assert_equal "You've already used this code.", check("ONCE").message
    assert check("TWICE").valid?
    PromoRedemption.create!(promo_code: twice, user: @user, kind: twice.kind, redeemed_at: Time.current)
    assert_equal :already_used, check("TWICE").reason
  end

  test "plan and interval mismatches name what the code is for" do
    make_code(code: "STUDIOONLY", plan_codes: ["studio"])
    make_code(code: "BOTHPLANS", plan_codes: %w[pro studio])
    make_code(code: "ANNUALONLY", intervals: ["annual"])
    assert_equal :plan_mismatch, check("STUDIOONLY").reason
    assert_equal "This code is for the Studio plan.", check("STUDIOONLY").message
    assert check("STUDIOONLY", plan: "studio").valid?
    assert_equal "This code is for the Pro and Studio plans.", check("BOTHPLANS", plan: "enterprise").message
    assert_equal :interval_mismatch, check("ANNUALONLY").reason
    assert_equal "This code is for annual billing only.", check("ANNUALONLY").message
    assert check("ANNUALONLY", interval: "annual").valid?
  end

  test "own referral code is refused, someone else's works with the programme effect" do
    other, = create_person("Referrer Person")
    mine = PromoCodes::Generator.referral_for(@user)
    theirs = PromoCodes::Generator.referral_for(other)
    assert_equal :self_referral, check(mine.code).reason
    assert_equal "You can't use your own referral code.", check(mine.code).message
    result = check(theirs.code)
    assert result.valid?
    assert_equal({ percentOff: 20, durationPeriods: 3, trialDays: nil, earlyAccessDays: nil }, result.effect)
  end

  test "a person can only ever redeem one referral code" do
    a, = create_person("Ref A")
    b, = create_person("Ref B")
    PromoRedemption.create!(promo_code: PromoCodes::Generator.referral_for(a), user: @user, kind: "referral", redeemed_at: Time.current)
    assert_equal :already_used, check(PromoCodes::Generator.referral_for(b).code).reason
  end

  test "a turned-off referral programme makes referral codes inactive" do
    other, = create_person("Ref C")
    code = PromoCodes::Generator.referral_for(other).code
    BillingConfig.stub(:referral_enabled?, false) { assert_equal :inactive, check(code).reason }
  end

  test "against live Razorpay a discount code needs an offer id; the simulator and mock do not" do
    make_code(code: "NOOFFER")
    make_code(code: "WITHOFFER", razorpay_offer_id: "offer_123")
    with_env("RAZORPAY_KEY_ID" => "rzp_test_x", "RAZORPAY_SIMULATOR" => nil) do
      assert_equal :needs_offer, check("NOOFFER").reason
      assert check("WITHOFFER").valid?
      assert PromoCode.find_by(code: "NOOFFER").needs_offer?
      other, = create_person("Ref D")
      referral = PromoCodes::Generator.referral_for(other).code
      with_env("RAZORPAY_REFERRAL_OFFER_ID" => nil) { assert_equal :needs_offer, check(referral).reason }
      with_env("RAZORPAY_REFERRAL_OFFER_ID" => "offer_ref") { assert check(referral).valid? }
    end
    with_env("RAZORPAY_KEY_ID" => "rzp_test_x", "RAZORPAY_SIMULATOR" => "true") { assert check("NOOFFER").valid? }
    with_env("RAZORPAY_KEY_ID" => nil) { assert check("NOOFFER").valid? }
  end

  test "early access says when seats are gone or the account is not an employer" do
    make_code(kind: "early_access", code: "EARLYX")
    BillingConfig.stub(:early_access_seats, 0) { assert_equal :seats_exhausted, check("EARLYX").reason }
    talent, = create_person("Artist", "jobseeker")
    assert_equal :not_eligible, check("EARLYX", user: talent).reason
    assert check("EARLYX").valid?
  end
end
