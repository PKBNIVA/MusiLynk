# One row per lifecycle reminder email actually sent (BillingRemindersJob), so a job retry or a
# double cron fire never sends the same reminder twice: the unique index on
# (subscription_id, kind, sent_on) is the idempotency guard, not application logic.
#
# Lock profile: new table + indexes only; nothing existing is locked.
class CreateBillingReminders < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    create_table :billing_reminders, id: :string do |t|
      t.string :subscription_id, null: false
      t.string :kind, null: false
      t.date :sent_on, null: false
      t.timestamps
    end

    add_index :billing_reminders, [:subscription_id, :kind, :sent_on], unique: true, name: "index_billing_reminders_on_sub_kind_date"
    add_foreign_key :billing_reminders, :subscriptions, column: :subscription_id, on_delete: :cascade
    add_check_constraint :billing_reminders, "kind IN ('trial_ending', 'renewal_ending', 'early_access_7d', 'early_access_1d')", name: "billing_reminders_kind_valid"
  end
end
