# Records an intended refund computed from BookingFeePolicy's cancellation/no-show rules. This
# table never moves money by itself: every row is created with status "pending_manual" (the
# existing refund path only reacts to a signed Razorpay refund.processed webhook — see
# BookingPayment#apply_refund! — there is no outbound "create a refund" call anywhere in this
# codebase), and an admin actions it manually in the Razorpay dashboard. When that webhook later
# marks the matching booking_payment "refunded", the matching pending_manual row (if any) is
# marked "done" automatically (see Billing::BillingController#process_booking_payment).
#
# Lock profile: new table + indexes only; nothing existing is locked.
class CreateRefundRecords < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    create_table :refund_records, id: :string do |t|
      t.string :booking_request_id, null: false
      t.string :booking_payment_id
      t.string :requested_by_id, null: false
      t.string :decided_by_id
      t.integer :amount, null: false
      t.string :currency, null: false
      t.integer :refund_percent, null: false
      t.string :reason, null: false
      t.string :status, null: false, default: "pending_manual"
      t.integer :policy_version, null: false, default: 0
      t.text :note
      t.datetime :decided_at
      t.timestamps
    end

    add_index :refund_records, :booking_request_id
    add_index :refund_records, :booking_payment_id
    add_index :refund_records, :status
    add_foreign_key :refund_records, :booking_requests, column: :booking_request_id
    add_foreign_key :refund_records, :booking_payments, column: :booking_payment_id, on_delete: :nullify
    add_foreign_key :refund_records, :users, column: :requested_by_id
    add_foreign_key :refund_records, :users, column: :decided_by_id, on_delete: :nullify
    add_check_constraint :refund_records, "status IN ('pending_manual', 'done', 'not_applicable')", name: "refund_records_status_valid"
    add_check_constraint :refund_records, "refund_percent >= 0 AND refund_percent <= 100", name: "refund_records_percent_valid"
    add_check_constraint :refund_records, "amount >= 0", name: "refund_records_amount_nonnegative"
  end
end
