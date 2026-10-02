# AI credit purchases: one-time top-ups and the MusiLynk AI Plus subscription. Entirely separate
# from Billing::BillingController's plan catalogue; every purchase endpoint here answers 503
# until AI_BILLING_ENABLED is "true", so nothing can charge a real card until Razorpay is
# actually configured for this product.
module Ai
  class BillingController < ApplicationController
    def self.enabled? = ENV["AI_BILLING_ENABLED"] == "true"

    before_action -> { authenticate! }
    before_action :require_billing_enabled

    # POST /api/ai/topups { pack: "small"|"large" }
    def create_topup
      pack = params[:pack].to_s
      spec = AiPricing.topups[pack.to_sym]
      return render_error("Unknown top-up pack.", :bad_request, "UNKNOWN_PACK") unless spec

      idempotency_key = request.headers["Idempotency-Key"].to_s.strip.presence
      if idempotency_key.present?
        existing = AiTopupPayment.where(user: current_user, pack:, status: "created", provider: "razorpay")
          .where.not(provider_order_id: nil).order(created_at: :desc).first
        return render json: { payment: existing, checkout: topup_checkout(existing.provider_order_id, existing.amount * 100, existing.currency) } if existing
      end

      return render_error("Live billing is not configured.", :service_unavailable) if RazorpayConfig.key_present? && !RazorpayConfig.usable?
      # Without keys, production must never fall through to the mock path that credits for free.
      return render_error("Live billing is not configured.", :service_unavailable) if !RazorpayConfig.key_present? && Rails.env.production?

      payment = AiTopupPayment.create!(user: current_user, pack:, amount: spec.fetch(:price_inr), currency: "INR",
        credits: spec.fetch(:credits), provider: RazorpayConfig.key_present? ? "razorpay" : "internal", status: "created")

      unless RazorpayConfig.key_present?
        payment.credit!
        return render json: { payment:, checkout: { mode: "mock" } }
      end

      order = RazorpayGateway.new.create_order(amount_paise: payment.amount * 100, currency: payment.currency, receipt: "aitopup_#{payment.id.to_s.split('_', 2).last.delete('-')}".first(40),
        notes: { ai_topup_payment_id: payment.id, user_id: current_user.id })
      payment.update!(provider_order_id: order.fetch("id"))
      render json: { payment:, checkout: topup_checkout(order.fetch("id"), payment.amount * 100, payment.currency) }
    rescue RazorpayGateway::GatewayError => error
      render_error(error.message, :bad_gateway)
    end

    # POST /api/ai/topups/verify { paymentRecordId, orderId, paymentId, signature }
    def verify_topup
      payment = AiTopupPayment.find_by(id: params[:paymentRecordId], user: current_user)
      return render_error("Top-up not found.", :not_found) unless payment
      return render json: { ok: true, alreadyCredited: true } if payment.status == "paid"
      return render_error("Payment order mismatch.", :unprocessable_content) unless payment.provider_order_id.present? &&
        ActiveSupport::SecurityUtils.secure_compare(payment.provider_order_id, params[:orderId].to_s)

      secret = ENV["RAZORPAY_KEY_SECRET"].to_s
      return render_error("Online payment is not switched on yet.", :service_unavailable, "PAYMENTS_UNAVAILABLE") if secret.empty?

      expected = OpenSSL::HMAC.hexdigest("SHA256", secret, "#{payment.provider_order_id}|#{params[:paymentId]}")
      return render_error("Invalid payment signature.", :unauthorized) unless ActiveSupport::SecurityUtils.secure_compare(expected, params[:signature].to_s)

      payment.update!(provider_payment_id: params[:paymentId])
      result = payment.credit!
      render json: { ok: true, alreadyCredited: result == :already_paid }
    rescue ActiveRecord::RecordNotUnique
      render json: { ok: true, alreadyCredited: true }
    end

    # POST /api/ai/plus/subscribe — MusiLynk AI Plus, available to any account, independent of the
    # hiring/talent subscription plan (a user may hold both at once; they don't conflict).
    def subscribe_plus
      return render_error("You already have MusiLynk AI Plus.", :conflict, "ALREADY_SUBSCRIBED") if Subscription.where(user: current_user, plan_code: "ai_plus", status: %w[active trialing pending]).exists?

      unless RazorpayConfig.key_present?
        return render_error("Live billing is not configured.", :service_unavailable) if Rails.env.production?

        sub = Subscription.create!(user: current_user, plan_code: "ai_plus", provider: "internal", status: "active", current_period_start: Time.current, current_period_end: 1.month.from_now)
        return render json: { subscription: sub, checkout: { mode: "mock" } }
      end

      plan_id = ENV["RAZORPAY_PLAN_AI_PLUS"].presence or return render_error("Razorpay plan is not configured.", :service_unavailable)
      return render_error("Live billing is not configured.", :service_unavailable) unless RazorpayConfig.usable?

      sub = Subscription.create!(user: current_user, plan_code: "ai_plus", provider: "razorpay", status: "pending")
      provider_sub = RazorpayGateway.new.create_subscription(plan_id:, notes: { user_id: current_user.id, plan_code: "ai_plus" })
      sub.update!(provider_subscription_id: provider_sub.fetch("id"))
      render json: { subscription: sub, checkout: { mode: "razorpay", keyId: RazorpayConfig.key_id, subscriptionId: provider_sub.fetch("id") } }
    rescue RazorpayGateway::GatewayError => error
      sub&.update!(status: "cancelled")
      render_error(error.message, :bad_gateway)
    end

    private

    def require_billing_enabled
      return if self.class.enabled?

      render_error("AI credit purchases are not enabled yet.", :service_unavailable, "AI_BILLING_DISABLED")
    end

    def topup_checkout(order_id, amount_paise, currency)
      { mode: "razorpay", keyId: RazorpayConfig.key_id, orderId: order_id, amount: amount_paise, currency: }.merge(RazorpayConfig.simulator? ? { simulator: true } : {})
    end
  end
end
