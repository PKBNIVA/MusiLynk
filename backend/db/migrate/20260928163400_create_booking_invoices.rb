# One invoice per successful (paid) booking deposit payment where the platform fee was enabled at
# the time of payment. invoice_number is unique per financial year (India, April-March):
# "V/<FY start>-<FY end short>/<seq>", e.g. "V/2026-27/000001". financial_year is stored
# separately so the per-FY sequence (see Invoice.next_number_for) never needs to parse the number.
class CreateBookingInvoices < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    create_table :invoices, id: :string do |t|
      t.string :booking_payment_id, null: false
      t.string :invoice_number, null: false
      t.string :financial_year, null: false
      t.integer :sequence_number, null: false
      t.integer :deposit_amount, null: false
      t.integer :fee_amount, null: false
      t.integer :gst_amount, null: false
      t.integer :total_amount, null: false
      t.string :currency, null: false
      t.integer :policy_version, null: false
      t.timestamps
    end

    add_index :invoices, :booking_payment_id, unique: true
    add_index :invoices, :invoice_number, unique: true
    add_index :invoices, [:financial_year, :sequence_number], unique: true
    add_foreign_key :invoices, :booking_payments, column: :booking_payment_id
  end
end
