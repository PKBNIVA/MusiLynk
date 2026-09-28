require "test_helper"

class AiSpendGuardTest < ActiveSupport::TestCase
  def ledger_row(cost_inr:, tier:, created_at: Time.current)
    AiCreditLedger.create!(account_type: "user", account_id: "usr_x", delta: -1, reason: "usage", task: "post_caption",
      period: AiCredits.current_period(created_at), cost_inr:, metadata: { "tier" => tier }, created_at:)
  end

  test "free tier pauses once free_tier_monthly_budget_inr is reached; paid usage is unaffected" do
    cap = AiPricing.budgets.fetch(:free_tier_monthly_budget_inr)
    ledger_row(cost_inr: cap, tier: "free")

    error = assert_raises(AiSpendGuard::Paused) { AiSpendGuard.check!(tier: "free") }
    assert_equal "AI_FREE_PAUSED", error.code

    assert_nil AiSpendGuard.check!(tier: "paid")
  end

  test "hard budget stops everything except admin" do
    cap = AiPricing.budgets.fetch(:hard_monthly_budget_inr)
    ledger_row(cost_inr: cap, tier: "paid")

    error = assert_raises(AiSpendGuard::Paused) { AiSpendGuard.check!(tier: "paid") }
    assert_equal "AI_HARD_PAUSED", error.code
    error = assert_raises(AiSpendGuard::Paused) { AiSpendGuard.check!(tier: "free") }
    assert_equal "AI_HARD_PAUSED", error.code

    assert_nil AiSpendGuard.check!(tier: "paid", admin: true)
  end

  test "below both budgets, nothing is raised" do
    ledger_row(cost_inr: 1, tier: "free")
    assert_nil AiSpendGuard.check!(tier: "free")
    assert_nil AiSpendGuard.check!(tier: "paid")
  end
end
