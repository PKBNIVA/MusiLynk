# Daily lifecycle reminders (the "anti-silent-renewal" promise): nobody is charged, or moved off
# a free trial or Early Access Pro, without a heads-up email first. Runs once a day (see
# config/initializers/good_job.rb `cron`).
#
# Idempotency is the BillingReminder row's unique index on (subscription_id, kind, sent_on), not
# application logic: `remind_once` below only ever inserts, and a duplicate insert is caught and
# treated as "already sent" rather than raised, so a retried or doubled cron fire never resends a
# reminder that already went out today.
#
# Every email includes a one-click cancel link built from BillingCancelToken; NotificationEmail
# renders it as-is (it is already an absolute URL) and NotificationEmailJob applies the usual
# opt-out/suppression/verified-email checks before anything is actually sent.
class BillingRemindersJob < ApplicationJob
  queue_as :scheduled

  TRIAL_WARNING_DAYS = 3
  RENEWAL_WARNING_DAYS = 3
  EARLY_ACCESS_WARNING_DAYS = [7, 1].freeze

  def perform(today = Date.current)
    remind_trials_ending(today)
    remind_renewals(today)
    remind_early_access_ending(today)
  end

  private

  def remind_trials_ending(today)
    target = today + TRIAL_WARNING_DAYS
    Subscription.where(status: "trialing").where(trial_ends_at: day_range(target)).find_each do |sub|
      remind_once(sub, "trial_ending", today) do
        NotificationEmailJob.perform_later(sub.user_id, "trial_ending_soon",
          "endsOn" => IndianFormat.date(sub.trial_ends_at), "path" => cancel_url(sub))
      end
    end
  end

  def remind_renewals(today)
    target = today + RENEWAL_WARNING_DAYS
    Subscription.where(status: "active").where.not(current_period_end: nil).where(current_period_end: day_range(target)).find_each do |sub|
      plan = Billing::BillingController::PLANS[sub.plan_code]
      next_amount = PlanPricing.next_amount(sub)
      amount = next_amount ? PlanPricing.format_inr(next_amount) : "the plan amount"
      credit_days = BillingCredit.pending.where(user_id: sub.user_id).sum(:days)
      remind_once(sub, "renewal_ending", today) do
        NotificationEmailJob.perform_later(sub.user_id, "plan_renewing_soon",
          "planName" => plan ? plan[:name] : sub.plan_code, "renewsOn" => IndianFormat.date(sub.current_period_end),
          "amount" => amount, "interval" => sub.interval, "creditDays" => credit_days, "path" => cancel_url(sub))
      end
    end
  end

  def remind_early_access_ending(today)
    EARLY_ACCESS_WARNING_DAYS.each do |days_out|
      target = today + days_out
      kind = "early_access_#{days_out}d"
      Subscription.where(status: "early_access").where(trial_ends_at: day_range(target)).find_each do |sub|
        remind_once(sub, kind, today) do
          NotificationEmailJob.perform_later(sub.user_id, "early_access_ending",
            "days" => days_out == 1 ? "1 day" : "#{days_out} days", "endsOn" => IndianFormat.date(sub.trial_ends_at), "path" => cancel_url(sub))
        end
      end
    end
  end

  def day_range(date) = date.beginning_of_day..date.end_of_day

  def remind_once(subscription, kind, today)
    BillingReminder.create!(subscription_id: subscription.id, kind:, sent_on: today)
    yield
  rescue ActiveRecord::RecordNotUnique
    nil
  end

  def cancel_url(subscription)
    token = CGI.escape(BillingCancelToken.generate(subscription))
    "#{NotificationEmail.frontend_url}#{NotificationEmail.workspace(subscription.user)}/billing?cancel=1&t=#{token}"
  end
end
