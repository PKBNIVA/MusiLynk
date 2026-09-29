# Loads config/billing.yml once per process, the same pattern AiPricing uses for
# config/ai_pricing.yml. Right now this only holds the Early Access Pro program's knobs.
class BillingConfig
  CONFIG_PATH = Rails.root.join("config/billing.yml")

  def self.config
    @config ||= YAML.safe_load(File.read(CONFIG_PATH), aliases: true).fetch(Rails.env, {}).deep_symbolize_keys
  end

  def self.reload! = @config = nil

  def self.early_access = config.fetch(:early_access)
  def self.early_access_enabled? = early_access.fetch(:enabled)
  def self.early_access_seats = early_access.fetch(:seats)
  def self.early_access_days = early_access.fetch(:days)
end
