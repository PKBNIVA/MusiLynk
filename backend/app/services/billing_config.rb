# Loads config/billing.yml once per process, the same pattern AiPricing uses for
# config/ai_pricing.yml. It holds the Early Access Pro, code generator and referral programme settings.
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

  def self.codes = config.fetch(:codes)
  def self.code_format = codes.fetch(:format)
  def self.code_alphabet = codes.fetch(:alphabet)

  def self.referral = config.fetch(:referral)
  def self.referral_enabled? = referral.fetch(:enabled)
  # The one Razorpay Offer applied to every referred hirer. Env wins over the file so it can be
  # set from Railway without a deploy.
  def self.referral_offer_id = ENV["RAZORPAY_REFERRAL_OFFER_ID"].presence || referral[:razorpay_offer_id].presence
end
