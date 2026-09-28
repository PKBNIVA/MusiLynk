# Self-hosted funnel analytics event log (POST /api/events). No third-party analytics: this is
# the whole store. Never holds email addresses or free text — see EventsController::ALLOWED_NAMES
# and the 1KB per-event size cap enforced there.
#
# Lock profile: new table + indexes only.
class CreateProductEvents < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    create_table :product_events, id: :string do |t|
      t.string :user_id
      t.string :anon_id, null: false
      t.string :name, null: false
      t.jsonb :props, null: false, default: {}
      t.string :page
      t.string :referrer
      t.string :city
      t.datetime :created_at, null: false
    end

    add_index :product_events, [:name, :created_at]
    add_index :product_events, :anon_id
    add_index :product_events, :user_id
    add_foreign_key :product_events, :users, column: :user_id, on_delete: :nullify
  end
end
