# A printable invoice for a paid booking deposit where the platform fee was enabled at payment
# time (see InvoiceGenerator). invoice_number is unique and sequential within one Indian financial
# year (April-March): "V/<FY>/<seq>", e.g. "V/2026-27/000001". GST fields are read from
# LegalConfig at render time (see Invoice#gst_fields), never stored twice, so a later correction to
# config/legal.yml is reflected on every invoice's printed page without touching this row.
class Invoice < ApplicationRecord
  belongs_to :booking_payment

  validates :invoice_number, :financial_year, presence: true
  validates :sequence_number, numericality: { only_integer: true, greater_than: 0 }
  validates :currency, format: { with: /\A[A-Z]{3}\z/ }

  # India's financial year runs 1 April - 31 March. "2026-27" for any date from 2026-04-01 to
  # 2027-03-31.
  def self.financial_year_for(date)
    year = date.month >= 4 ? date.year : date.year - 1
    "#{year}-#{(year + 1) % 100}"
  end

  # Atomically reserves the next sequence number within `financial_year`, so two invoices
  # generated at the same instant across two financial years, or within the same one, never
  # collide (the unique index on [financial_year, sequence_number] is the final backstop).
  def self.next_sequence_for(financial_year)
    transaction do
      last = where(financial_year:).order(sequence_number: :desc).lock.first
      (last&.sequence_number || 0) + 1
    end
  end

  def self.number_for(financial_year, sequence_number)
    format("V/%s/%06d", financial_year, sequence_number)
  end
end
