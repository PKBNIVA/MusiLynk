# The GST invoice / bill of supply issued for one paid subscription charge. The seller block, the
# buyer block and the line items are snapshots taken when the invoice is issued, so editing a
# billing profile or config/legal.yml later never rewrites a document that was already issued.
# Money is in paise. invoice_counters hands out the gap-free number within a financial year.
class CreateTaxInvoices < ActiveRecord::Migration[8.1]
  def change
    create_table :invoice_counters, id: false do |t|
      t.string :series, null: false
      t.string :financial_year, null: false
      t.integer :last_value, null: false, default: 0
      t.timestamps
    end
    add_index :invoice_counters, %i[series financial_year], unique: true

    create_table :tax_invoices, id: :string do |t|
      t.references :user, type: :string, null: false, foreign_key: true
      t.references :subscription, type: :string, null: true, foreign_key: { on_delete: :nullify }
      t.references :billing_profile, type: :string, null: true, foreign_key: { on_delete: :nullify }
      t.string :invoice_number, null: false
      t.string :financial_year, null: false
      t.integer :sequence_number, null: false
      t.string :document_type, null: false
      t.datetime :issued_at, null: false
      t.string :provider_payment_id, null: false
      t.string :provider_invoice_id
      t.string :currency, null: false, default: "INR"
      t.jsonb :seller, null: false, default: {}
      t.jsonb :buyer, null: false, default: {}
      t.jsonb :line_items, null: false, default: []
      t.string :sac_code
      t.string :place_of_supply_code
      t.bigint :taxable_paise, null: false
      t.bigint :cgst_paise, null: false, default: 0
      t.bigint :sgst_paise, null: false, default: 0
      t.bigint :igst_paise, null: false, default: 0
      t.bigint :total_paise, null: false
      t.string :refund_status
      t.string :refund_reference
      t.datetime :refunded_at
      t.timestamps
    end
    add_index :tax_invoices, :invoice_number, unique: true
    add_index :tax_invoices, %i[financial_year sequence_number], unique: true
    add_index :tax_invoices, :provider_payment_id, unique: true
    add_index :tax_invoices, :issued_at
    add_check_constraint :tax_invoices, "document_type IN ('tax_invoice','bill_of_supply')", name: "tax_invoices_document_type_valid"
    add_check_constraint :tax_invoices, "taxable_paise + cgst_paise + sgst_paise + igst_paise = total_paise", name: "tax_invoices_totals_add_up"
  end
end
