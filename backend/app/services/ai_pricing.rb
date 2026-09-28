# Loads config/ai_pricing.yml once per process. Every credits/cost number in the AI product
# lives here, never inline in a controller or service, so ops can retune without a deploy that
# touches code (a restart still picks up a changed file in development/test; production loads
# it once at boot like any other Rails config).
class AiPricing
  CONFIG_PATH = Rails.root.join("config/ai_pricing.yml")

  def self.config
    @config ||= YAML.safe_load(File.read(CONFIG_PATH), aliases: true).fetch(Rails.env, {}).deep_symbolize_keys
  end

  def self.reload! = @config = nil

  def self.allowances = config.fetch(:allowances)
  def self.topups = config.fetch(:topups)
  def self.ai_plus = config.fetch(:ai_plus)
  def self.task_costs = config.fetch(:task_costs)
  def self.long_tasks = config.fetch(:long_tasks).map(&:to_s)
  def self.model_pricing = config.fetch(:model_pricing)
  def self.budgets = config.fetch(:budgets)
  def self.output_caps = config.fetch(:output_caps)
  def self.cache_ttl = config.fetch(:cache_ttl_hours).hours

  # Credits charged for one call of `task`. `rank_applicants` costs 1 per 10 applicants
  # (rounded up); every other task costs a flat, task-specific amount.
  def self.cost_for(task, applicant_count: nil)
    task = task.to_s
    return [(applicant_count.to_i / 10.0).ceil, 1].max if task == "rank_applicants" && applicant_count

    task_costs.fetch(task.to_sym, 1)
  end

  def self.long_task?(task) = long_tasks.include?(task.to_s)

  # Estimated INR cost of one API call from its reported token usage.
  def self.estimate_cost_inr(input_tokens:, output_tokens:, batch: false)
    pricing = model_pricing
    usd = (input_tokens.to_i / 1_000_000.0) * pricing.fetch(:input_per_mtok_usd) +
      (output_tokens.to_i / 1_000_000.0) * pricing.fetch(:output_per_mtok_usd)
    usd *= pricing.fetch(:batch_discount) if batch
    (usd * pricing.fetch(:usd_to_inr)).round(4)
  end

  def self.public_catalogue
    {
      freeCreditsPerMonth: allowances.fetch(:talent_free),
      aiPlus: { planCode: ai_plus.fetch(:plan_code), priceInr: ai_plus.fetch(:price_inr), creditsPerMonth: ai_plus.fetch(:credits_per_month) },
      planAllowances: { pro: allowances.fetch(:pro), studio: allowances.fetch(:studio), enterprise: allowances.fetch(:enterprise) },
      topups: topups.except(:expires_after_months).transform_values { |v| { priceInr: v.fetch(:price_inr), credits: v.fetch(:credits) } },
      topupExpiresAfterMonths: topups.fetch(:expires_after_months),
      taskCosts: task_costs
    }
  end
end
