# Additive fee-breakdown snapshot on a quote, computed by BookingFeePolicy at creation time (see
# BookingsController#quote). All default to 0 (fee_percent/policy_version too) so a quote created
# before the fee feature existed reads the same as one created with the fee at 0: "no fee".
#
# Lock profile: booking_quotes is small; a short lock_timeout fails fast rather than queues behind
# a long-running statement.
class AddFeeBreakdownToBookingQuotes < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    change_table :booking_quotes, bulk: true do |t|
      t.integer :fee_amount, null: false, default: 0
      t.integer :gst_amount, null: false, default: 0
      t.decimal :fee_percent, precision: 6, scale: 2, null: false, default: "0.0"
      t.integer :policy_version, null: false, default: 0
    end
    add_check_constraint :booking_quotes, "fee_amount >= 0 AND gst_amount >= 0", name: "booking_quotes_fee_breakdown_nonnegative"
  end
end
