# A nudge to write a review after an urgent request is filled or a booking completes
# (ReviewPromptSweepJob). One row per (source, user): both parties get their own prompt. The
# reminder fires at most once, 3 days after notified_at, if the review is still unwritten.
class ReviewPrompt < ApplicationRecord
  SOURCE_TYPES = %w[urgent_request booking_request].freeze
  REMINDER_AFTER = 3.days

  belongs_to :user
  belongs_to :counterpart, class_name: "User", foreign_key: :counterpart_user_id

  validates :source_type, inclusion: { in: SOURCE_TYPES }
  validates :source_id, :counterpart_name, presence: true

  scope :due_for_reminder, -> {
    where(completed_at: nil, reminded_at: nil)
      .where.not(notified_at: nil)
      .where("notified_at <= ?", REMINDER_AFTER.ago)
  }

  def notified? = notified_at.present?
  def completed? = completed_at.present?
end
