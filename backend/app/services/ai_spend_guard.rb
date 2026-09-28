# Global spend guard: caps the whole backend's AI bill, independent of any one account's
# credits. Checked before AiCredits.charge! and before any model call.
#
# - free_tier_monthly_budget_inr reached: free-tier usage (accounts with no paid plan and no
#   Verse AI Plus) pauses with 402 AI_FREE_PAUSED; paid/plan credits keep working.
# - hard_monthly_budget_inr reached: everything stops except admin-initiated calls.
#
# Spend is read straight from ai_credit_ledgers.cost_inr for the current calendar month — the
# same rows AiCredits writes on every charge — so the guard never drifts from the ledger.
class AiSpendGuard
  class Paused < StandardError
    attr_reader :code

    def initialize(message, code:)
      super(message)
      @code = code
    end
  end

  def self.month_bounds(now = Time.current) = [now.beginning_of_month, now.end_of_month]

  def self.total_spend_inr(now: Time.current)
    from, to = month_bounds(now)
    AiCreditLedger.where(reason: "usage", created_at: from..to).sum(:cost_inr)
  end

  def self.free_tier_spend_inr(now: Time.current)
    from, to = month_bounds(now)
    AiCreditLedger.where(reason: "usage", created_at: from..to).where("metadata->>'tier' = 'free'").sum(:cost_inr)
  end

  # Raises AiSpendGuard::Paused (AI_FREE_PAUSED or AI_HARD_PAUSED) when the guard blocks this
  # call; admin: true bypasses both budgets (only the hard budget's own "stop everything except
  # admin" language exempts admin, per the brief).
  def self.check!(tier:, admin: false, now: Time.current)
    budgets = AiPricing.budgets
    hard = budgets.fetch(:hard_monthly_budget_inr)
    unless admin
      if total_spend_inr(now:) >= hard
        raise Paused.new("AI assist has reached this month's usage limit and is temporarily paused. Please try again next month.", code: "AI_HARD_PAUSED")
      end
    end

    return unless tier == "free" && !admin

    free_cap = budgets.fetch(:free_tier_monthly_budget_inr)
    return unless free_tier_spend_inr(now:) >= free_cap

    raise Paused.new("Free AI credits have reached this month's usage limit. Upgrade to Verse AI Plus or buy a top-up to keep going.", code: "AI_FREE_PAUSED")
  end
end
