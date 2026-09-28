# The data behind the printable invoice page (browser print — see src/app/pages/Invoice.tsx).
# Visible only to the payer or the act owner on that booking. GSTIN and legal-entity fields come
# from config/legal.yml at render time (never fabricated: a blank GSTIN renders blank).
class InvoicesController < ApplicationController
  before_action -> { authenticate!("jobseeker", "employer") }

  def show
    invoice = Invoice.includes(booking_payment: { booking_request: :act }).find(params[:id])
    payment = invoice.booking_payment
    booking = payment.booking_request
    allowed = payment.payer_id == current_user.id || booking.act.owner_id == current_user.id
    return render_error("Invoice not found", :not_found) unless allowed

    render json: {
      invoiceNumber: invoice.invoice_number, financialYear: invoice.financial_year,
      createdAt: invoice.created_at, currency: invoice.currency,
      depositAmount: invoice.deposit_amount, feeAmount: invoice.fee_amount, gstAmount: invoice.gst_amount,
      totalAmount: invoice.total_amount, policyVersion: invoice.policy_version,
      actName: booking.act.name, payerName: payment.payer.name, bookingId: booking.id,
      seller: LegalConfig.public_json
    }
  end
end
