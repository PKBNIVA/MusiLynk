module PromoCodes
  # Decides whether `user` may use `code` for `plan_code` on `interval`, and what it does.
  # Returns a Result: valid? with an `effect`, or a `reason` with a human `message`.
  class Validator
    Result = Struct.new(:valid, :reason, :message, :promo, :kind, :effect, keyword_init: true) do
      def valid? = valid
    end

    MESSAGES = {
      unknown: "That code isn't valid.",
      inactive: "This code is no longer active.",
      expired: "This code has expired.",
      not_started: "This code isn't active yet.",
      exhausted: "This code has been fully redeemed.",
      already_used: "You've already used this code.",
      self_referral: "You can't use your own referral code.",
      needs_offer: "This code can't be applied to live billing yet.",
      seats_exhausted: "All Early Access Pro seats have been taken.",
      not_eligible: "This code isn't available for your account."
    }.freeze
    PLAN_NAMES = { "pro" => "Pro", "studio" => "Studio" }.freeze

    # Live Razorpay applies a discount only through an Offer; the local mock and the simulator
    # record the percentage themselves.
    def self.offer_required? = RazorpayConfig.key_present? && !RazorpayConfig.simulator?

    def self.call(code:, user:, plan_code:, interval: "monthly")
      new(code:, user:, plan_code:, interval:).call
    end

    def initialize(code:, user:, plan_code:, interval:)
      @code = code.to_s.strip.upcase
      @user = user
      @plan_code = plan_code.to_s
      @interval = interval.to_s
    end

    def call
      promo = @code.present? ? PromoCode.find_by(code: @code) : nil
      return refuse(:unknown) unless promo
      return refuse(:inactive, promo) if !promo.active || (promo.kind == "referral" && !BillingConfig.referral_enabled?)

      now = Time.current
      return refuse(:not_started, promo) if promo.starts_at && promo.starts_at > now
      return refuse(:expired, promo) if promo.expires_at && promo.expires_at <= now
      return refuse(:self_referral, promo) if promo.owner_user_id.present? && promo.owner_user_id == @user.id
      return refuse(:exhausted, promo) if promo.max_redemptions && promo.redemptions_count >= promo.max_redemptions
      return refuse(:already_used, promo) if already_used?(promo)
      return refuse(:plan_mismatch, promo, plan_message(promo)) if promo.plan_codes.any? && !promo.plan_codes.include?(@plan_code)
      return refuse(:interval_mismatch, promo, "This code is for #{promo.intervals.first} billing only.") if promo.intervals.any? && !promo.intervals.include?(@interval)
      return refuse(:needs_offer, promo) if promo.needs_offer?

      if promo.kind == "early_access"
        refusal = EarlyAccessGrant.refusal_for(@user)
        return refuse(refusal.code == "EARLY_ACCESS_SEATS_EXHAUSTED" ? :seats_exhausted : :not_eligible, promo, refusal.message) if refusal
      end

      Result.new(valid: true, promo:, kind: promo.kind, effect: effect_for(promo), message: "Code applied.")
    end

    private

    def already_used?(promo)
      return true if promo.kind == "referral" && PromoRedemption.exists?(user_id: @user.id, kind: "referral")

      PromoRedemption.where(promo_code_id: promo.id, user_id: @user.id).count >= promo.per_user_limit
    end

    def plan_message(promo)
      names = promo.plan_codes.map { PLAN_NAMES.fetch(_1, _1.to_s.capitalize) }
      "This code is for the #{names.to_sentence} #{names.size == 1 ? 'plan' : 'plans'}."
    end

    def effect_for(promo)
      effect = { percentOff: nil, durationPeriods: nil, trialDays: nil, earlyAccessDays: nil }
      case promo.kind
      when "discount_percent", "referral" then effect.merge(percentOff: promo.percent, durationPeriods: promo.periods)
      when "extended_trial" then effect.merge(trialDays: promo.trial_days)
      else effect.merge(earlyAccessDays: BillingConfig.early_access_days)
      end
    end

    def refuse(reason, promo = nil, message = nil)
      Result.new(valid: false, reason:, message: message || MESSAGES.fetch(reason), promo:, kind: promo&.kind)
    end
  end
end
