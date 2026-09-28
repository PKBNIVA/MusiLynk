require "test_helper"
require "minitest/mock"

class AiSpendGuardTest < ActiveSupport::TestCase
  def ledger_row(cost_inr:, tier:, created_at: Time.current)
    AiCreditLedger.create!(account_type: "user", account_id: "usr_x", delta: -1, reason: "usage", task: "post_caption",
      period: AiCredits.current_period(created_at), cost_inr:, metadata: { "tier" => tier }, created_at:)
  end

  test "free tier pauses once free_tier_monthly_budget_inr is reached" do
    cap = AiPricing.budgets.fetch(:free_tier_monthly_budget_inr)
    ledger_row(cost_inr: cap, tier: "free")

    error = assert_raises(AiSpendGuard::Paused) { AiSpendGuard.check!(tier: "free") }
    assert_equal "AI_FREE_PAUSED", error.code
    assert_equal "AI help is resting this month. Everything else works as usual.", error.message
  end

  # At launch free_tier_monthly_budget_inr == hard_monthly_budget_inr (no purchasable paid AI
  # tier exists to protect separately), so a paid account is paused too once that shared cap is
  # reached — this is expected, not a regression. The code still supports the two budgets
  # differing (for whenever paid AI comes back), covered here by stubbing them apart.
  test "when the free and hard budgets differ, a paid account is unaffected by the free-tier cap alone" do
    AiPricing.stub(:budgets, { free_tier_monthly_budget_inr: 100, hard_monthly_budget_inr: 100_000 }) do
      ledger_row(cost_inr: 100, tier: "free")

      assert_raises(AiSpendGuard::Paused) { AiSpendGuard.check!(tier: "free") }
      assert_nil AiSpendGuard.check!(tier: "paid")
    end
  end

  test "hard budget stops everything except admin, with the same AI_FREE_PAUSED code and copy" do
    cap = AiPricing.budgets.fetch(:hard_monthly_budget_inr)
    ledger_row(cost_inr: cap, tier: "paid")

    error = assert_raises(AiSpendGuard::Paused) { AiSpendGuard.check!(tier: "paid") }
    assert_equal "AI_FREE_PAUSED", error.code
    assert_equal AiSpendGuard::PAUSE_MESSAGE, error.message
    error = assert_raises(AiSpendGuard::Paused) { AiSpendGuard.check!(tier: "free") }
    assert_equal "AI_FREE_PAUSED", error.code

    assert_nil AiSpendGuard.check!(tier: "paid", admin: true)
  end

  test "below both budgets, nothing is raised" do
    ledger_row(cost_inr: 1, tier: "free")
    assert_nil AiSpendGuard.check!(tier: "free")
    assert_nil AiSpendGuard.check!(tier: "paid")
  end
end
