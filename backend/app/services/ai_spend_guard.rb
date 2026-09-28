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

  # Launch mode: hard_monthly_budget_inr and free_tier_monthly_budget_inr are set to the same
  # ₹1,500 cap (there is no purchasable paid AI tier to protect separately right now), so both
  # budgets raise the same code and copy — the person never sees a distinction between "free"
  # and "hard" that no longer exists for them.
  PAUSE_MESSAGE = "AI help is resting this month. Everything else works as usual.".freeze

  # Raises AiSpendGuard::Paused (code: AI_FREE_PAUSED) when the guard blocks this call;
  # admin: true bypasses both budgets (only the hard budget's own "stop everything except
  # admin" language exempts admin, per the brief).
  def self.check!(tier:, admin: false, now: Time.current)
    return if admin

    budgets = AiPricing.budgets
    if tier == "free" && free_tier_spend_inr(now:) >= budgets.fetch(:free_tier_monthly_budget_inr)
      raise Paused.new(PAUSE_MESSAGE, code: "AI_FREE_PAUSED")
    end

    return unless total_spend_inr(now:) >= budgets.fetch(:hard_monthly_budget_inr)

    raise Paused.new(PAUSE_MESSAGE, code: "AI_FREE_PAUSED")
  end
end
