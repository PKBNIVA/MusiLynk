# One row per lifecycle reminder email actually sent (BillingRemindersJob). Its unique index on
# (subscription_id, kind, sent_on) is the only idempotency guard: see that job's remind_once.
class BillingReminder < ApplicationRecord
  KINDS = %w[trial_ending renewal_ending early_access_7d early_access_1d].freeze

  belongs_to :subscription

  validates :kind, inclusion: { in: KINDS }
  validates :sent_on, presence: true
end
