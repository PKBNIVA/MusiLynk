# Early Access Pro (config/billing.yml `early_access`): a free run of Pro for `days` days, no
# card, to the first `seats` employer accounts. Shared by the admin grant endpoint and by an
# `early_access` promo code so both go through exactly the same checks and seat count. A seat,
# once granted, is never freed back up even if later revoked (Subscription#early_access).
class EarlyAccessGrant
  Refusal = Struct.new(:message, :status, :code, keyword_init: true)
  LOCK_KEY = 71_530_412

  # A Refusal when `user` cannot be granted Early Access Pro right now, otherwise nil.
  def self.refusal_for(user)
    return Refusal.new(message: "Early access grants are turned off.", status: :service_unavailable) unless BillingConfig.early_access_enabled?
    return Refusal.new(message: "Early Access Pro can only be granted to employer accounts.", status: :unprocessable_content) unless user.employer?

    if Subscription.where(early_access: true).count >= BillingConfig.early_access_seats
      return Refusal.new(message: "All #{BillingConfig.early_access_seats} Early Access Pro seats have been granted.", status: :conflict, code: "EARLY_ACCESS_SEATS_EXHAUSTED")
    end

    paid_mandate = Subscription.where(user:, status: %w[active trialing], provider: "razorpay").where.not(provider_subscription_id: nil).exists?
    return Refusal.new(message: "This account already has an active paid subscription.", status: :conflict, code: "ALREADY_SUBSCRIBED") if paid_mandate

    nil
  end

  # Returns [subscription, nil] or [nil, Refusal]. The seat check and insert share an advisory
  # lock so two concurrent grants can never both take the last seat.
  def self.call(user:)
    Subscription.transaction do
      ActiveRecord::Base.lease_connection.execute("SELECT pg_advisory_xact_lock(#{LOCK_KEY})")
      refusal = refusal_for(user)
      return [nil, refusal] if refusal

      days = BillingConfig.early_access_days
      subscription = Subscription.create!(user:, plan_code: "pro", provider: "internal", status: "early_access",
        early_access: true, trial_started_at: Time.current, trial_ends_at: days.days.from_now)
      [subscription, nil]
    end
  end

  def self.seats_taken = Subscription.where(early_access: true).count
end
