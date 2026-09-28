# Same additive fee-breakdown snapshot as booking_quotes, but for the actual amount charged on
# this payment (see BookingsController#payment_order). Defaults to 0, so every payment row that
# exists before this feature, and every one created while the fee is off, reads as "no fee" —
# byte-identical to the amount charged before this migration.
class AddFeeBreakdownToBookingPayments < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    change_table :booking_payments, bulk: true do |t|
      t.integer :fee_amount, null: false, default: 0
      t.integer :gst_amount, null: false, default: 0
      t.decimal :fee_percent, precision: 6, scale: 2, null: false, default: "0.0"
      t.integer :policy_version, null: false, default: 0
    end
    add_check_constraint :booking_payments, "fee_amount >= 0 AND gst_amount >= 0", name: "booking_payments_fee_breakdown_nonnegative"
  end
end
