# Launch-mode cost controls for the profile_from_links AI task, separate from AiSpendGuard's
# shared ₹1,500 monthly cap and from AiUsageCap's profile_headline/profile_bio limits:
# - talent_lifetime_limit (3): a signed-in account's total profile_from_links AI runs, ever,
#   counted the same way AiUsageCap counts launch-task usage — off ai_credit_ledgers "usage"
#   rows for this task, not a separate table.
# - anonymous_limit (1): one AI-assisted run per throttle IP in the sign-up flow, before an
#   account exists to attach a ledger row to — tracked in Rails.cache instead.
# - profile_import_monthly_budget_inr: this task's own spend cap (config/ai_pricing.yml), read
#   from the same ledger rows' cost_inr, filtered to this task only.
class LinkImport::Budget
  TALENT_LIFETIME_LIMIT = 3
  ANONYMOUS_LIMIT = 1
  TASK = "profile_from_links".freeze

  def self.monthly_cap_inr = AiPricing.config.fetch(:profile_import_monthly_budget_inr)

  def self.spend_inr(now: Time.current)
    from, to = AiSpendGuard.month_bounds(now)
    AiCreditLedger.where(reason: "usage", task: TASK, created_at: from..to).sum(:cost_inr)
  end

  def self.available?(now: Time.current) = spend_inr(now:) < monthly_cap_inr

  def self.used_count(user)
    AiCreditLedger.for_account("user", user.id).where(reason: "usage", task: TASK).count
  end

  def self.remaining_for(user) = [TALENT_LIFETIME_LIMIT - used_count(user), 0].max

  def self.record_spend!(user, cost_inr:, now: Time.current)
    AiCreditLedger.create!(account_type: "user", account_id: user.id, delta: 0, reason: "usage", task: TASK,
      period: AiCredits.current_period(now), cost_inr:, metadata: { "source" => "profile_import" }, created_at: now)
  end

  def self.anonymous_key(ip) = "link-import:profile-from-links-anon:#{Digest::SHA256.hexdigest(ip.to_s)}"

  def self.anonymous_available?(ip) = ip.present? && Rails.cache.read(anonymous_key(ip)).to_i < ANONYMOUS_LIMIT

  def self.record_anonymous!(ip)
    return unless ip.present?
    Rails.cache.write(anonymous_key(ip), Rails.cache.read(anonymous_key(ip)).to_i + 1, expires_in: 30.days)
  end
end
