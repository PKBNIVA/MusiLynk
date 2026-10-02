# The GST tax invoice (or bill of supply) for one paid subscription charge. Distinct from Invoice,
# which is the booking-deposit platform-fee invoice. Everything printed is a snapshot taken when
# the invoice was issued (seller, buyer, line items, tax split); amounts are whole paise.
#
# Numbers are "<prefix>/<financial year>/<6-digit sequence>", e.g. VRS/2026-27/000123, drawn from
# invoice_counters inside the same transaction that inserts the invoice, so a rollback also rolls
# the counter back and the sequence has no gaps.
class TaxInvoice < ApplicationRecord
  DOCUMENT_TYPES = %w[tax_invoice bill_of_supply].freeze

  belongs_to :user
  belongs_to :subscription, optional: true
  belongs_to :billing_profile, optional: true

  validates :invoice_number, :financial_year, :provider_payment_id, presence: true
  validates :document_type, inclusion: { in: DOCUMENT_TYPES }
  validates :sequence_number, numericality: { only_integer: true, greater_than: 0 }

  scope :newest_first, -> { order(issued_at: :desc, id: :desc) }

  def tax_invoice? = document_type == "tax_invoice"
  def refunded? = refund_status.present?
  def seller_pending? = seller.is_a?(Hash) && seller["pending"] == true

  # Atomically takes the next number for a series and financial year. The UPDATE locks the counter
  # row until the surrounding transaction ends, which serialises concurrent issuers.
  def self.next_sequence!(series, financial_year)
    raise "TaxInvoice.next_sequence! must run inside the transaction that saves the invoice" unless lease_connection.transaction_open?

    now = Time.current
    lease_connection.exec_query(
      "INSERT INTO invoice_counters (series, financial_year, last_value, created_at, updated_at) VALUES ($1, $2, 0, $3, $3) ON CONFLICT (series, financial_year) DO NOTHING",
      "invoice counter", [series, financial_year, now]
    )
    lease_connection.select_value(sanitize_sql_array([
      "UPDATE invoice_counters SET last_value = last_value + 1, updated_at = ? WHERE series = ? AND financial_year = ? RETURNING last_value", now, series, financial_year
    ])).to_i
  end

  def self.number_for(series, financial_year, sequence) = format("%s/%s/%06d", series, financial_year, sequence)

  def self.financial_year_at(time) = Invoice.financial_year_for(time.in_time_zone("Asia/Kolkata").to_date)

  # JSON for the owner's invoice list.
  def list_json
    { id:, invoiceNumber: invoice_number, issuedAt: issued_at, documentType: document_type, totalPaise: total_paise, currency:,
      buyerName: buyer["name"], refunded: refunded?, refundReference: refund_reference }
  end

  # JSON for the invoice page; the seller and buyer blocks are the issue-time snapshots.
  def document_json
    { id:, invoiceNumber: invoice_number, financialYear: financial_year, issuedAt: issued_at, documentType: document_type, currency:, seller:, buyer:,
      lineItems: line_items, sacCode: sac_code, placeOfSupply: place_of_supply_code ? { code: place_of_supply_code, name: IndianStates.name(place_of_supply_code) } : nil,
      taxableValuePaise: taxable_paise, cgstPaise: cgst_paise, sgstPaise: sgst_paise, igstPaise: igst_paise, totalPaise: total_paise,
      ratePercent: tax_invoice? ? InvoiceTax::GST_RATE_PERCENT : 0, amountInWords: AmountInWords.paise(total_paise),
      paymentReference: provider_payment_id, refund: refunded? ? { status: refund_status, reference: refund_reference, at: refunded_at } : nil }
  end
end
