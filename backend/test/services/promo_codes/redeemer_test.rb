require "test_helper"
require_relative "../../support/promo_code_helpers"

class PromoCodesRedeemerTest < ActiveSupport::TestCase
  include PromoCodeHelpers

  setup { @user, = create_person("Redeemer Buyer") }

  def redeem(promo, user: @user, plan: "pro", interval: "monthly", &block)
    PromoCodes::Redeemer.call(promo:, user:, plan_code: plan, interval:, &block)
  end

  test "redeeming counts, writes the redemption and links the subscription the block builds" do
    promo = make_code(code: "R20", max_redemptions: 5)
    outcome = redeem(promo) { Subscription.create!(user: @user, plan_code: "pro", provider: "internal", status: "active") }
    assert_equal 1, promo.reload.redemptions_count
    redemption = outcome.redemption
    assert_equal [@user.id, "discount_percent", 20, outcome.subscription.id], [redemption.user_id, redemption.kind, redemption.percent_off, redemption.subscription_id]
  end

  test "it is transactional: a failure in the block leaves no count or redemption" do
    promo = make_code(code: "ROLL")
    assert_raises(RuntimeError) { redeem(promo) { raise "boom" } }
    assert_equal 0, promo.reload.redemptions_count
    assert_equal 0, PromoRedemption.count
  end

  test "a refused code raises with the validator's reason and changes nothing" do
    promo = make_code(code: "GONE", active: false)
    error = assert_raises(PromoCodes::Redeemer::Refused) { redeem(promo) }
    assert_equal :inactive, error.result.reason
    assert_equal 0, promo.reload.redemptions_count
  end

  test "the redemption cap and the per-user limit are enforced" do
    promo = make_code(code: "CAP1", max_redemptions: 1)
    other, = create_person("Second Buyer")
    redeem(promo)
    assert_equal :exhausted, assert_raises(PromoCodes::Redeemer::Refused) { redeem(promo, user: other) }.result.reason
    assert_equal :exhausted, assert_raises(PromoCodes::Redeemer::Refused) { redeem(promo) }.result.reason

    twice = make_code(code: "TWICE", per_user_limit: 2)
    2.times { redeem(twice) }
    assert_equal :already_used, assert_raises(PromoCodes::Redeemer::Refused) { redeem(twice) }.result.reason
    assert_equal 2, twice.reload.redemptions_count
  end

  test "an early access code grants Early Access Pro through the shared path" do
    promo = make_code(kind: "early_access", code: "EARLY")
    outcome = redeem(promo)
    sub = outcome.subscription
    assert_equal ["pro", "early_access", true, promo.id], [sub.plan_code, sub.status, sub.early_access, sub.promo_code_id]
    assert_in_delta BillingConfig.early_access_days.days.from_now.to_f, sub.trial_ends_at.to_f, 5
    assert_equal "pro", Entitlements.for(@user).plan_code
  end

  test "early access seats are capped, and a code that races past the validator is refused" do
    promo = make_code(kind: "early_access", code: "EARLYCAP")
    BillingConfig.stub(:early_access_seats, 1) do
      other, = create_person("Seat Taker")
      redeem(promo, user: other)
      assert_equal :seats_exhausted, assert_raises(PromoCodes::Redeemer::Refused) { redeem(promo) }.result.reason
    end
    assert_equal 1, promo.reload.redemptions_count

    racing = make_code(kind: "early_access", code: "RACE")
    fresh, = create_person("Racer")
    stub_refusal = EarlyAccessGrant::Refusal.new(message: "All 50 Early Access Pro seats have been granted.", status: :conflict)
    EarlyAccessGrant.stub(:call, [nil, stub_refusal]) do
      assert_equal :seats_exhausted, assert_raises(PromoCodes::Redeemer::Refused) { redeem(racing, user: fresh) }.result.reason
    end
    assert_equal 0, racing.reload.redemptions_count
  end

  test "release gives a redemption back when checkout then fails" do
    promo = make_code(code: "GIVEBACK")
    outcome = redeem(promo) { Subscription.create!(user: @user, plan_code: "pro", provider: "razorpay", status: "pending") }
    PromoCodes::Redeemer.release(outcome.subscription)
    assert_equal 0, promo.reload.redemptions_count
    assert_equal 0, PromoRedemption.count
    assert redeem(promo).redemption.persisted?
  end
end
