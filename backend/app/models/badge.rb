# A small, time-boxed award shown on a profile/talent card. Currently just
# "fast_responder_week" (FastResponderWeekJob), unique per user per ISO week.
class Badge < ApplicationRecord
  KINDS = %w[fast_responder_week].freeze

  belongs_to :user

  validates :kind, inclusion: { in: KINDS }
  validates :awarded_for, presence: true

  scope :of_kind, ->(kind) { where(kind: kind) }
  scope :current_week, -> { where(awarded_for: Badge.iso_week(Time.current)) }

  def self.iso_week(time = Time.current) = time.strftime("%G-W%V")
end
