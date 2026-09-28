# Shapes GET /api/ai/usage and the upgradeOptions offered on a 402.
class AiUsageReport
  def self.for(resolution, now: Time.current)
    period = AiCredits.current_period(now)
    allowance_used = AiCreditLedger.for_account(resolution.account_type, resolution.account_id).in_period(period)
      .where(reason: %w[usage refund]).sum(:delta).abs
    recent = AiCreditLedger.for_account(resolution.account_type, resolution.account_id).where(reason: %w[usage refund])
      .order(created_at: :desc).limit(20).map { { task: _1.task, credits: -_1.delta, date: _1.created_at } }

    {
      balance: AiCredits.balance(resolution.account_type, resolution.account_id, now:),
      monthlyAllowance: AiCreditAccount.monthly_allowance(resolution, hirer: false) || nil,
      usedThisPeriod: allowance_used,
      resetsAt: AiCredits.period_resets_at(now),
      plan: resolution.plan_code,
      recent: recent
    }
  end

  def self.upgrade_options
    pricing = AiPricing
    {
      aiPlus: { planCode: pricing.ai_plus.fetch(:plan_code), priceInr: pricing.ai_plus.fetch(:price_inr), creditsPerMonth: pricing.ai_plus.fetch(:credits_per_month) },
      topups: pricing.topups.except(:expires_after_months).transform_values { |v| { priceInr: v.fetch(:price_inr), credits: v.fetch(:credits) } }
    }
  end
end
