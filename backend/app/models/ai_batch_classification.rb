# One queued row per portfolio item awaiting classification through the Anthropic Message
# Batches API. AiBatchSubmitJob moves rows queued -> submitted -> completed/failed.
class AiBatchClassification < ApplicationRecord
  STATUSES = %w[queued submitted completed failed].freeze

  validates :status, inclusion: { in: STATUSES }
  validates :portfolio_item_id, :account_type, :account_id, presence: true

  scope :queued, -> { where(status: "queued") }
  scope :submitted, -> { where(status: "submitted") }
end
