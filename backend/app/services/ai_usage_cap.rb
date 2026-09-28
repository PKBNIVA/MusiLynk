# Launch-mode usage caps (see config/ai_pricing.yml `launch:`): talent tasks (profile_headline,
# profile_bio) cap at a lifetime total per account; hirer tasks (job_description,
# job_screening_questions) cap at a monthly total. Read straight off the rows AiCredits.charge!
# already writes to ai_credit_ledgers (reason "usage") — there is no separate counter, and
# nothing here is a "credits" number shown to the person, just how many of their free AI uses
# are left.
#
# Checked in AiController before AiOrchestrator.run, so a capped-out account never reaches the
# model (or the legacy credits ledger, which — at the launch allowances — would not otherwise
# stop it: 5 and 10 are both well under the existing 20/month free allowance).
class AiUsageCap
  class Exceeded < StandardError
    attr_reader :remaining, :limit, :period

    def initialize(remaining:, limit:, period:)
      @remaining = remaining
      @limit = limit
      @period = period
      super("AI help is used up for now.")
    end
  end

  def self.hirer_task?(task) = AiPricing.hirer_tasks.include?(task.to_s)
  def self.talent_task?(task) = AiPricing.talent_tasks.include?(task.to_s)
  def self.launch_task?(task) = hirer_task?(task) || talent_task?(task)

  # {remaining:, limit:, period:} for the account's own launch task group, from the caller's
  # role — used both to gate a call and to answer GET /api/ai/usage.
  def self.for(user, hirer:, now: Time.current)
    limit = hirer ? AiPricing.hirer_monthly_limit : AiPricing.talent_lifetime_limit
    period = hirer ? "month" : "lifetime"
    used = used_count(user, hirer:, now:)
    { remaining: [limit - used, 0].max, limit:, period: }
  end

  def self.used_count(user, hirer:, now: Time.current)
    tasks = hirer ? AiPricing.hirer_tasks : AiPricing.talent_tasks
    scope = AiCreditLedger.for_account("user", user.id).where(reason: "usage", task: tasks)
    scope = scope.in_period(AiCredits.current_period(now)) if hirer
    scope.count
  end

  # Raises Exceeded when `task`'s launch group is already used up for this account. A no-op for
  # a task outside both launch groups (nothing to cap).
  def self.check!(user, task:, now: Time.current)
    return unless launch_task?(task)

    status = self.for(user, hirer: hirer_task?(task), now:)
    raise Exceeded.new(**status) if status.fetch(:remaining) <= 0
  end
end
