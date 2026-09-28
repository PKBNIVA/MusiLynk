class UrgentRequest < ApplicationRecord
  STATUSES = %w[open filled cancelled expired].freeze
  # Requests older than this are past their usefulness and are hidden from the open list
  # even when nobody marked them cancelled/expired (see UrgentRequestsController#index and
  # Admin::UrgentRequestsController#sweep_expired).
  STALE_AFTER = 3.days

  belongs_to :requester, class_name: "User"
  belongs_to :filled_by, class_name: "User", optional: true
  has_many :urgent_request_responses, dependent: :destroy
  has_many :urgent_request_notifications, dependent: :destroy
  validates :title, :role_name, :city, :start_at, presence: true
  validates :status, inclusion: { in: STATUSES }
  validates :budget_min, :budget_max, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true
  validate :valid_schedule_and_budget

  scope :open_and_recent, -> { where(status: "open").where("start_at >= ?", STALE_AFTER.ago) }

  # Minutes since the request was posted, for the admin "no response after 60 min" flag.
  def age_minutes = ((Time.current - created_at) / 60).round

  # Whether this request was filled within 24 hours of being posted (the launch metric).
  def filled_within_24h? = status == "filled" && updated_at <= created_at + 24.hours

  private

  def valid_schedule_and_budget
    errors.add(:end_at, "must be after the start") if start_at && end_at && end_at <= start_at
    errors.add(:budget_max, "must be at least the minimum") if budget_min && budget_max && budget_max < budget_min
  end
end
