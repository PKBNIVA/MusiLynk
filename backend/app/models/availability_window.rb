class AvailabilityWindow < ApplicationRecord
  STATUSES = %w[available hold tentative booked unavailable].freeze
  # Clock skew between the browser and the server.
  PAST_TOLERANCE = 5.minutes

  belongs_to :user
  validates :start_at, :end_at, presence: true
  validates :status, inclusion: { in: STATUSES, message: "must be one of #{STATUSES.join(', ')}" }
  validates :city, length: { maximum: 120 }
  validates :note, length: { maximum: 500 }
  validate :ends_after_start
  validate :starts_in_the_future, on: :create

  private

  def ends_after_start
    errors.add(:end_at, "must be after the start") if start_at && end_at && end_at <= start_at
  end

  # New windows describe upcoming availability; a slot that has already started is not useful to
  # anyone booking. Existing windows are never invalidated by time passing.
  def starts_in_the_future
    errors.add(:start_at, "must be in the future") if start_at && start_at < Time.current - PAST_TOLERANCE
  end
end
