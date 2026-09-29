# A code an admin creates (or, for referrals, a user is issued lazily) that changes what a
# checkout costs or how long it is free. One table, four kinds:
#   discount_percent  percent_off for duration_periods billing periods (nil = forever)
#   extended_trial    trial_days instead of the plan's normal trial, even after a previous trial
#   early_access      Early Access Pro (seat-capped, same grant path as the admin endpoint)
#   referral          owned by a user; the referee gets the programme discount (config/billing.yml)
# See PromoCodes::Validator for who may use one and PromoCodes::Redeemer for redeeming.
class PromoCode < ApplicationRecord
  KINDS = %w[discount_percent extended_trial early_access referral].freeze
  ADMIN_KINDS = (KINDS - %w[referral]).freeze
  PAID_PLANS = %w[pro studio].freeze
  INTERVALS = %w[monthly annual].freeze
  CODE_FORMAT = /\A[A-Z0-9][A-Z0-9_-]{2,39}\z/

  belongs_to :owner, class_name: "User", foreign_key: :owner_user_id, optional: true
  belongs_to :created_by, class_name: "User", optional: true
  has_many :redemptions, class_name: "PromoRedemption", dependent: nil

  before_validation { self.code = code.to_s.strip.upcase.presence }
  before_validation { self.razorpay_offer_id = razorpay_offer_id.to_s.strip.presence }

  validates :code, presence: true, format: { with: CODE_FORMAT, message: "must be 3-40 letters, digits, dashes or underscores" },
    uniqueness: { case_sensitive: false }
  validates :kind, inclusion: { in: KINDS }
  validates :percent_off, numericality: { only_integer: true, in: 1..100 }, if: -> { kind == "discount_percent" }
  validates :percent_off, absence: true, unless: -> { kind == "discount_percent" }
  validates :duration_periods, numericality: { only_integer: true, greater_than_or_equal_to: 1 }, allow_nil: true
  validates :trial_days, numericality: { only_integer: true, in: 1..365 }, if: -> { kind == "extended_trial" }
  validates :trial_days, absence: true, unless: -> { kind == "extended_trial" }
  validates :max_redemptions, numericality: { only_integer: true, greater_than_or_equal_to: 1 }, allow_nil: true
  validates :per_user_limit, numericality: { only_integer: true, greater_than_or_equal_to: 1 }
  validates :notes, length: { maximum: 2000 }
  validate :plans_and_intervals_known
  validate :window_is_ordered

  scope :referral_issued, -> { where(kind: "referral") }

  def discount? = %w[discount_percent referral].include?(kind)

  # Live Razorpay only honours a discount through an Offer attached to the subscription, so a
  # discount code with no offer id cannot be applied to real billing (PromoCodes::Validator).
  def offer_id = kind == "referral" ? BillingConfig.referral_offer_id : razorpay_offer_id
  def needs_offer? = discount? && PromoCodes::Validator.offer_required? && offer_id.blank?

  def percent = kind == "referral" ? BillingConfig.referral[:referee_percent_off] : percent_off
  def periods = kind == "referral" ? BillingConfig.referral[:referee_duration_periods] : duration_periods

  private

  def plans_and_intervals_known
    errors.add(:plan_codes, "must be a list of paid plans (#{PAID_PLANS.join(', ')})") unless plan_codes.is_a?(Array) && (plan_codes - PAID_PLANS).empty?
    errors.add(:intervals, "must be a list of monthly and/or annual") unless intervals.is_a?(Array) && (intervals - INTERVALS).empty?
  end

  def window_is_ordered
    errors.add(:expires_at, "must be after the start time") if starts_at && expires_at && expires_at <= starts_at
  end
end
