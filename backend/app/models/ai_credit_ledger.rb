# Append-only ledger of every AI credit grant and spend. Balance for an account+period is the
# sum of its `delta`s; a refund is a new offsetting row, never an update to the spent row, so the
# history stays auditable (see backend/docs/ai-credits.md).
class AiCreditLedger < ApplicationRecord
  ACCOUNT_TYPES = %w[user organization].freeze
  REASONS = %w[monthly_allowance usage refund topup admin_grant expiry].freeze

  validates :account_type, inclusion: { in: ACCOUNT_TYPES }
  validates :account_id, presence: true
  validates :reason, inclusion: { in: REASONS }
  validates :delta, numericality: { only_integer: true }

  scope :for_account, ->(account_type, account_id) { where(account_type:, account_id:) }
  scope :in_period, ->(period) { where(period:) }
  scope :not_expired, ->(now = Time.current) { where("expires_at IS NULL OR expires_at > ?", now) }
end
