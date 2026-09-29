# One table for promo, extended-trial, Early Access and referral codes (`kind`), the redemption
# log, and billing credits (referral reward days that could not be applied directly, e.g. on a
# live Razorpay subscription, are recorded here instead of touching Razorpay's schedule).
#
# The (promo_code_id, user_id) pair is deliberately not a unique index: `per_user_limit` above 1
# allows repeat redemptions, so the limit is enforced in PromoCodes::Redeemer under a row lock.
#
# Lock profile: three new tables and their indexes; the subscriptions FK was added with its
# column in the previous migration and is created here now that the referenced table exists.
class CreatePromoCodes < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    create_table :promo_codes, id: :string do |t|
      t.citext :code, null: false
      t.string :kind, null: false
      t.integer :percent_off
      t.integer :duration_periods
      t.integer :trial_days
      t.jsonb :plan_codes, null: false, default: []
      t.jsonb :intervals, null: false, default: []
      t.string :razorpay_offer_id
      t.integer :max_redemptions
      t.integer :redemptions_count, null: false, default: 0
      t.integer :per_user_limit, null: false, default: 1
      t.datetime :starts_at
      t.datetime :expires_at
      t.boolean :active, null: false, default: true
      t.string :owner_user_id
      t.string :created_by_id
      t.text :notes
      t.string :batch_id
      t.timestamps
    end
    add_index :promo_codes, :code, unique: true
    add_index :promo_codes, :batch_id
    add_index :promo_codes, :owner_user_id, unique: true, where: "owner_user_id IS NOT NULL", name: "index_promo_codes_on_owner_user_id"
    add_foreign_key :promo_codes, :users, column: :owner_user_id, on_delete: :nullify
    add_foreign_key :promo_codes, :users, column: :created_by_id, on_delete: :nullify
    add_check_constraint :promo_codes, "kind IN ('discount_percent', 'extended_trial', 'early_access', 'referral')", name: "promo_codes_kind_valid"
    add_check_constraint :promo_codes, "percent_off IS NULL OR (percent_off BETWEEN 1 AND 100)", name: "promo_codes_percent_off_valid"
    add_check_constraint :promo_codes, "duration_periods IS NULL OR duration_periods >= 1", name: "promo_codes_duration_valid"
    add_check_constraint :promo_codes, "trial_days IS NULL OR trial_days >= 1", name: "promo_codes_trial_days_valid"
    add_check_constraint :promo_codes, "per_user_limit >= 1", name: "promo_codes_per_user_limit_valid"

    create_table :promo_redemptions, id: :string do |t|
      t.string :promo_code_id, null: false
      t.string :user_id, null: false
      t.string :subscription_id
      t.string :kind, null: false
      t.integer :percent_off
      t.integer :trial_days
      t.datetime :redeemed_at, null: false
      t.datetime :referrer_rewarded_at
      t.timestamps
    end
    add_index :promo_redemptions, %i[promo_code_id user_id], name: "index_promo_redemptions_on_code_and_user"
    add_index :promo_redemptions, :user_id
    add_index :promo_redemptions, :subscription_id
    add_foreign_key :promo_redemptions, :promo_codes, on_delete: :cascade
    add_foreign_key :promo_redemptions, :users, on_delete: :cascade
    add_foreign_key :promo_redemptions, :subscriptions, on_delete: :nullify

    create_table :billing_credits, id: :string do |t|
      t.string :user_id, null: false
      t.integer :days, null: false
      t.string :reason, null: false
      t.string :promo_redemption_id
      t.datetime :applied_at
      t.timestamps
    end
    add_index :billing_credits, %i[user_id reason], name: "index_billing_credits_on_user_and_reason"
    add_index :billing_credits, :promo_redemption_id, unique: true, where: "promo_redemption_id IS NOT NULL"
    add_foreign_key :billing_credits, :users, on_delete: :cascade
    add_foreign_key :billing_credits, :promo_redemptions, on_delete: :nullify
    add_check_constraint :billing_credits, "days > 0", name: "billing_credits_days_positive"

    add_foreign_key :subscriptions, :promo_codes, column: :promo_code_id, on_delete: :nullify
  end
end
