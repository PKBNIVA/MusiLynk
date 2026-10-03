module Admin
  # "Refunds to review": intended refunds computed by BookingFeePolicy from a cancellation or
  # no-show (see BookingsController#maybe_record_refund!). None of these move money — an admin
  # processes the refund manually in the Razorpay dashboard, then marks it done here (or it is
  # marked done automatically once the matching refund.processed webhook lands — see
  # Billing::BillingController#process_booking_payment).
  class RefundsController < BaseController
    include AdminPagination

    def index
      scope = RefundRecord.includes(:booking_payment, :requested_by, :decided_by, booking_request: %i[act requester]).order(created_at: :desc)
      scope = scope.where(status: params[:status]) if params[:status].present? && RefundRecord::STATUSES.include?(params[:status])
      rows, meta = admin_paginate(scope, default_per: 50)
      render json: { refunds: rows.map { refund_json(_1) } }.merge(meta)
    end

    def update
      refund = RefundRecord.find(params[:id])
      return render_error("Only a pending refund can be marked done.", :conflict) unless refund.status == "pending_manual"

      refund.mark_done!(decided_by: current_user, note: params[:note])
      audit!("admin.refund.mark_done", refund, { amount: refund.amount, currency: refund.currency })
      render json: refund_json(refund)
    end

    private

    def refund_json(r)
      { id: r.id, bookingRequestId: r.booking_request_id, bookingPaymentId: r.booking_payment_id,
        amount: r.amount, currency: r.currency, refundPercent: r.refund_percent, reason: r.reason,
        status: r.status, note: r.note, policyVersion: r.policy_version, requestedBy: r.requested_by&.name,
        decidedBy: r.decided_by&.name, decidedAt: r.decided_at, createdAt: r.created_at,
        actName: r.booking_request&.act&.name, requesterName: r.booking_request&.requester&.name }
    end
  end
end
