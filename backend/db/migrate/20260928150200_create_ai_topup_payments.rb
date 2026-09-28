# One-time AI credit top-up purchases (POST /api/ai/topups), independent of the subscription
# billing tables: a top-up is a single payment, not a recurring mandate.
#
# Lock profile: a new, empty table plus its indexes; nothing existing is locked except the
# catalog, and lock_timeout makes the migration fail fast rather than queue.
class CreateAiTopupPayments < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    create_table :ai_topup_payments, id: :string do |t|
      t.string :user_id, null: false
      t.string :pack, null: false
      t.integer :amount, null: false
      t.string :currency, null: false, default: "INR"
      t.string :provider, null: false
      t.string :status, null: false, default: "created"
      t.string :provider_order_id
      t.string :provider_payment_id
      t.integer :credits, null: false
      t.timestamps
    end

    add_index :ai_topup_payments, :user_id
    add_index :ai_topup_payments, :provider_order_id, unique: true, where: "provider_order_id IS NOT NULL"
    add_index :ai_topup_payments, :provider_payment_id, unique: true, where: "provider_payment_id IS NOT NULL"

    add_check_constraint :ai_topup_payments, "pack::text = ANY (ARRAY['small'::character varying, 'large'::character varying]::text[])", name: "ai_topup_payments_pack_valid"
    add_check_constraint :ai_topup_payments, "status::text = ANY (ARRAY['created'::character varying, 'paid'::character varying, 'failed'::character varying]::text[])", name: "ai_topup_payments_status_valid"
    add_check_constraint :ai_topup_payments, "provider::text = ANY (ARRAY['internal'::character varying, 'razorpay'::character varying]::text[])", name: "ai_topup_payments_provider_valid"
  end
end
