module PromoCodes
  # On the referred user's first successful payment, the referrer earns `referrer_reward_days`
  # extra days, up to `referrer_reward_cap` rewards. Every reward is a BillingCredit row. Days
  # are added straight onto an Early Access or internal (mock / admin-granted) subscription;
  # for a live Razorpay subscription, or no subscription at all, the credit stays unapplied
  # (Razorpay's schedule is never mutated from here) and is reported by BillingRemindersJob.
  class ReferralReward
    def self.for_subscription(subscription)
      PromoRedemption.where(subscription_id: subscription.id, kind: "referral", referrer_rewarded_at: nil).find_each { call(_1) }
    end

    def self.call(redemption)
      redemption.with_lock do
        next if redemption.referrer_rewarded_at

        referrer = redemption.promo_code.owner
        redemption.update!(referrer_rewarded_at: Time.current)
        next if referrer.nil? || referrer.id == redemption.user_id

        cap = BillingConfig.referral.fetch(:referrer_reward_cap)
        next if BillingCredit.where(user: referrer, reason: "referral_reward").count >= cap

        days = BillingConfig.referral.fetch(:referrer_reward_days)
        credit = BillingCredit.create!(user: referrer, days:, reason: "referral_reward", promo_redemption: redemption)
        credit.update!(applied_at: Time.current) if extend_subscription(referrer, days)
        credit
      end
    end

    def self.extend_subscription(referrer, days)
      sub = Entitlements.for(referrer).subscription
      return false unless sub && sub.provider == "internal"

      if sub.status == "early_access" || (sub.status == "trialing" && sub.trial_ends_at.present?)
        sub.update!(trial_ends_at: sub.trial_ends_at + days.days)
      elsif sub.status == "active" && sub.current_period_end.present?
        sub.update!(current_period_end: sub.current_period_end + days.days)
      else
        return false
      end
      true
    end
    private_class_method :extend_subscription
  end
end
