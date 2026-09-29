# Prices and Razorpay plan ids per billing interval, derived from
# Billing::BillingController::PLANS (annual = 10 x monthly, shown as "2 months free").
module PlanPricing
  INTERVALS = %w[monthly annual].freeze
  PERIOD_SECONDS = { "monthly" => 30 * 24 * 3600, "annual" => 365 * 24 * 3600 }.freeze

  module_function

  def plans = Billing::BillingController::PLANS

  # Rupees for one billing period of `plan_code`, or nil (free/enterprise have no annual price).
  def amount(plan_code, interval = "monthly")
    plans.dig(plan_code, INTERVALS.include?(interval) ? interval.to_sym : :monthly)
  end

  # Rupees for the next charge of `sub`, after any code discount still running.
  def next_amount(sub)
    base = amount(sub.plan_code, sub.interval)
    return nil unless base&.positive?

    sub.discount_active? ? (base * (100 - sub.discount_percent) / 100.0).round : base
  end

  # Razorpay plan ids: monthly keeps the original RAZORPAY_PLAN_<CODE> (RAZORPAY_PLAN_<CODE>_MONTHLY
  # also works); annual is RAZORPAY_PLAN_<CODE>_ANNUAL.
  def provider_plan_id(plan_code, interval)
    key = "RAZORPAY_PLAN_#{plan_code.to_s.upcase}"
    return ENV["#{key}_ANNUAL"].presence if interval == "annual"

    ENV[key].presence || ENV["#{key}_MONTHLY"].presence
  end

  # The inverse, used by the simulator: [plan_code, interval] for a plan id, or nil.
  def plan_for_provider_id(plan_id)
    plans.each_key do |code|
      next if %w[free enterprise].include?(code)

      INTERVALS.each { |interval| return [code, interval] if provider_plan_id(code, interval) == plan_id.to_s }
    end
    nil
  end

  # Whether annual checkout can work in this environment. With Razorpay keys configured every
  # annual plan id must be set; without keys (local mock or simulator) annual just works, except
  # in production where checkout itself is unavailable.
  def annual_available?(plan_code = nil)
    codes = (plan_code ? [plan_code.to_s] : plans.keys).select { plans.dig(_1, :annual).to_i.positive? }
    return false if codes.empty?
    return codes.all? { provider_plan_id(_1, "annual").present? } if RazorpayConfig.key_present?

    !Rails.env.production?
  end

  def format_inr(rupees) = "₹#{rupees.to_i.to_s.reverse.gsub(/(\d{3})(?=\d)/, '\\1,').reverse}"
end
