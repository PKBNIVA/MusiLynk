# MusiLynk AI as a paid product: a single append-only ledger of every credit grant and spend.
# Balance for an account+period is the sum of its rows; nothing here is ever updated in place
# except by a new offsetting row (refund), which keeps the history auditable.
#
# account_type/account_id: "user" or "organization" credits pool. period is "YYYY-MM" for
# monthly allowances; a topup or admin grant may span periods via expires_at instead.
#
# Lock profile: a new, empty table plus its indexes; nothing existing is locked except the
# catalog, and lock_timeout makes the migration fail fast rather than queue.
class CreateAiCreditLedgers < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    create_table :ai_credit_ledgers, id: :string do |t|
      t.string :account_type, null: false
      t.string :account_id, null: false
      t.integer :delta, null: false
      t.string :reason, null: false
      t.string :task
      t.string :period
      t.decimal :cost_inr, precision: 10, scale: 4, default: "0.0", null: false
      t.integer :tokens_in
      t.integer :tokens_out
      t.boolean :cached, default: false, null: false
      t.boolean :batch, default: false, null: false
      t.datetime :expires_at
      t.jsonb :metadata, default: {}, null: false
      t.datetime :created_at, null: false
    end

    add_index :ai_credit_ledgers, %i[account_type account_id period], name: "index_ai_credit_ledgers_on_account_and_period"
    add_index :ai_credit_ledgers, %i[account_type account_id created_at]
    add_index :ai_credit_ledgers, %i[account_type account_id reason period], unique: true, where: "reason = 'monthly_allowance'",
      name: "index_ai_credit_ledgers_unique_allowance_per_period"

    add_check_constraint :ai_credit_ledgers,
      "account_type::text = ANY (ARRAY['user'::character varying, 'organization'::character varying]::text[])",
      name: "ai_credit_ledgers_account_type_valid"
    add_check_constraint :ai_credit_ledgers,
      "reason::text = ANY (ARRAY['monthly_allowance'::character varying, 'usage'::character varying, 'refund'::character varying, 'topup'::character varying, 'admin_grant'::character varying, 'expiry'::character varying]::text[])",
      name: "ai_credit_ledgers_reason_valid"
  end
end
