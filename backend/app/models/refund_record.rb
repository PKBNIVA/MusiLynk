# An intended refund computed from BookingFeePolicy's cancellation/no-show rules. Every row is
# created with status "pending_manual" (see BookingsController#change_status): this codebase has
# no outbound "create a refund" call to Razorpay, only a webhook handler that reacts to a refund
# Razorpay already processed (BookingPayment#apply_refund!), so nothing here moves money. An admin
# marks a row "done" once they have processed it manually in the Razorpay dashboard, or the row is
# marked "done" automatically when the matching payment's refund webhook lands (see
# Billing::BillingController#process_booking_payment).
class RefundRecord < ApplicationRecord
  STATUSES = %w[pending_manual done not_applicable].freeze
  REASONS = %w[hirer_cancel musician_no_show hirer_no_show].freeze

  belongs_to :booking_request
  belongs_to :booking_payment, optional: true
  belongs_to :requested_by, class_name: "User"
  belongs_to :decided_by, class_name: "User", optional: true

  validates :amount, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :refund_percent, numericality: { only_integer: true, in: 0..100 }
  validates :currency, format: { with: /\A[A-Z]{3}\z/ }
  validates :reason, inclusion: { in: REASONS }
  validates :status, inclusion: { in: STATUSES }

  scope :awaiting_review, -> { where(status: "pending_manual").order(created_at: :asc) }

  def mark_done!(decided_by:, note: nil)
    update!(status: "done", decided_by:, decided_at: Time.current, note: [self.note, note].compact_blank.join("\n"))
  end
end
