module PromoCodes
  # Redeems a code for a user inside one transaction: re-validates under a row lock (so the
  # redemption cap and per-user limit cannot be beaten by two requests at once), applies the
  # effect, bumps `redemptions_count` and writes the PromoRedemption.
  #
  # Discount and trial codes attach to the subscription the caller builds in the block (which
  # receives the validated Result); an early_access code creates its subscription through
  # EarlyAccessGrant, the same path as the admin endpoint.
  class Redeemer
    class Refused < StandardError
      attr_reader :result

      def initialize(result)
        @result = result
        super(result.message)
      end
    end

    Outcome = Struct.new(:subscription, :redemption, :result, keyword_init: true)

    def self.call(promo:, user:, plan_code:, interval: "monthly", &block)
      PromoCode.transaction do
        promo.lock!
        result = Validator.call(code: promo.code, user:, plan_code:, interval:)
        raise Refused, result unless result.valid?

        subscription = if promo.kind == "early_access"
          granted, refusal = EarlyAccessGrant.call(user:)
          raise Refused, Validator::Result.new(valid: false, reason: :seats_exhausted, message: refusal.message, promo:, kind: promo.kind) if refusal

          granted.update!(promo_code: promo)
          granted
        else
          block&.call(result)
        end
        promo.increment!(:redemptions_count)
        redemption = PromoRedemption.create!(promo_code: promo, user:, subscription:, kind: promo.kind, redeemed_at: Time.current,
          percent_off: result.effect[:percentOff], trial_days: result.effect[:trialDays])
        Notifier.early_access_granted(subscription) if promo.kind == "early_access"
        Outcome.new(subscription:, redemption:, result:)
      end
    end

    # Undoes a redemption whose checkout then failed at the payment provider, so a lost
    # checkout does not burn the code.
    def self.release(subscription)
      PromoCode.transaction do
        PromoRedemption.where(subscription_id: subscription.id).find_each do |redemption|
          redemption.promo_code.lock!.decrement!(:redemptions_count) if redemption.promo_code.redemptions_count.positive?
          redemption.destroy!
        end
      end
    end
  end
end
