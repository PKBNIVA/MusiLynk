# Generates the one invoice for a paid booking deposit payment, only when the platform fee was
# enabled at the time that payment's fee breakdown was computed (payment.fee_amount.positive? ||
# payment.gst_amount.positive?). Idempotent: called again for the same payment, it returns the
# invoice already on file rather than allocating a second sequence number.
class InvoiceGenerator
  def self.for(payment)
    return nil unless payment.status == "paid"
    return nil unless payment.fee_amount.positive? || payment.gst_amount.positive?

    existing = Invoice.find_by(booking_payment_id: payment.id)
    return existing if existing

    Invoice.transaction do
      payment.lock!
      existing = Invoice.find_by(booking_payment_id: payment.id)
      next existing if existing

      fy = Invoice.financial_year_for(payment.provider_state_at || payment.created_at)
      seq = Invoice.next_sequence_for(fy)
      Invoice.create!(booking_payment: payment, invoice_number: Invoice.number_for(fy, seq), financial_year: fy,
        sequence_number: seq, deposit_amount: payment.amount - payment.fee_amount - payment.gst_amount,
        fee_amount: payment.fee_amount, gst_amount: payment.gst_amount, total_amount: payment.amount,
        currency: payment.currency, policy_version: payment.policy_version)
    end
  end
end
