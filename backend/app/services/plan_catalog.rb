# config/plans.yml through Settings: the subscription plans as the frozen hash the rest of the
# app has always read as Billing::BillingController::PLANS ({ "pro" => { code:, name:, monthly:,
# annual:, trialDays:, activePosts:, seats:, shortlist:, bookings: } }).
module PlanCatalog
  KEY_MAP = { trial_days: :trialDays, active_posts: :activePosts }.freeze

  module_function

  def all
    @all ||= Settings.load(:plans).fetch(:plans).to_h do |code, plan|
      [code.to_s, plan.to_h { |key, value| [KEY_MAP.fetch(key, key), value] }.freeze]
    end.freeze
  end

  def reload!
    @all = nil
    Settings.reload!(:plans)
  end

  def codes = all.keys
  def paid_codes = all.select { |_, plan| plan[:monthly].to_i.positive? }.keys
end
