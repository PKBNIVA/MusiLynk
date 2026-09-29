# Annual plans and codes: a subscription now records its billing interval ("monthly" | "annual")
# and, when a promo or referral code applied, which code and how many discounted billing periods
# it covers (`discount_periods` nil = forever, `discount_periods_used` counts charged periods).
#
# Lock profile: adding columns with constant defaults is instant on Postgres 11+; the check
# constraint and the index are on a small table.
class AddIntervalAndDiscountToSubscriptions < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :subscriptions, :interval, :string, default: "monthly", null: false
    add_column :subscriptions, :promo_code_id, :string
    add_column :subscriptions, :discount_percent, :integer
    add_column :subscriptions, :discount_periods, :integer
    add_column :subscriptions, :discount_periods_used, :integer, default: 0, null: false
    add_index :subscriptions, :promo_code_id
    add_check_constraint :subscriptions, %("interval" IN ('monthly', 'annual')), name: "subscriptions_interval_valid"
  end
end
