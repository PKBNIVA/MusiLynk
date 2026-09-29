# Read-side queries for the admin "Emails" view (Admin::EmailsController). Counts sent per
# lifecycle/digest/milestone key, and opt-out rates from profiles.email_preferences /
# email_notifications. Read-only, no caching needed (lifecycle_emails is small next to
# product_events).
class LifecycleEmailQueries
  def self.summary(days:)
    since = days.days.ago
    {
      windowDays: days,
      sentByKey: sent_by_key(since),
      optOutRates: opt_out_rates
    }
  end

  def self.sent_by_key(since)
    LifecycleEmail.where(sent_at: since..).group(:key).order(Arel.sql("count_all DESC")).count
      .map { |key, count| { key:, count: } }
  end

  # Share of profiles with the master switch off, and share with each granular category off
  # (among profiles that still have the master switch on, since an off master switch already
  # implies every category is off).
  def self.opt_out_rates
    total = Profile.count
    return { masterOff: 0, categories: {} } if total.zero?

    master_off = Profile.where(email_notifications: false).count
    master_on = total - master_off
    categories = Profile::EMAIL_PREFERENCE_CATEGORIES.index_with do |category|
      next 0 if master_on.zero?

      off = Profile.where(email_notifications: true).where("(email_preferences->>?) = 'false'", category).count
      ((off.to_f / master_on) * 100).round(1)
    end
    { masterOff: ((master_off.to_f / total) * 100).round(1), categories: }
  end
end
