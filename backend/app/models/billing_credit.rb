# Free days owed to a user (today only the referral reward). `applied_at` is set when the days
# were added straight onto an internal or Early Access subscription; a credit on a live Razorpay
# subscription stays unapplied, because Razorpay's billing schedule is never mutated from here.
# BillingRemindersJob mentions unapplied credits and the admin redemptions view lists them.
class BillingCredit < ApplicationRecord
  REASONS = %w[referral_reward].freeze

  belongs_to :user
  belongs_to :promo_redemption, optional: true

  validates :days, numericality: { only_integer: true, greater_than: 0 }
  validates :reason, inclusion: { in: REASONS }

  scope :pending, -> { where(applied_at: nil) }
end
