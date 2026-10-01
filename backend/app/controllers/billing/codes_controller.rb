module Billing
  # POST /api/billing/codes/validate: what would this code do for me on this plan and interval?
  # Always 200 for a well-formed question (an unusable code is `valid: false` with a reason),
  # so the pricing page can show the reason inline. Throttled, since it confirms codes exist.
  class CodesController < ApplicationController
    EMPTY_EFFECT = { percentOff: nil, durationPeriods: nil, trialDays: nil, earlyAccessDays: nil }.freeze

    def validate
      return unless authenticate!
      return unless throttle!("promo-validate", limit: 30, period: 1.minute)

      plan_code = params[:planCode].to_s
      interval = params[:interval].presence || "monthly"
      return render_error("Invalid plan", :bad_request) unless PromoCode::PAID_PLANS.include?(plan_code)
      return render_error("Invalid billing interval", :bad_request) unless PlanPricing::INTERVALS.include?(interval)
      return render_error("Enter a code.", :bad_request) unless params[:code].is_a?(String) && params[:code].strip.present?

      result = PromoCodes::Validator.call(code: params[:code].first(64), user: current_user, plan_code:, interval:)
      render json: { valid: result.valid?, reason: result.reason, kind: result.kind, effect: result.effect || EMPTY_EFFECT, message: result.message }
    end
  end
end
