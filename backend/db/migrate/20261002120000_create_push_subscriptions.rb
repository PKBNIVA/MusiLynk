# Web push: one row per browser/device a user allowed notifications on. The endpoint and the
# two encryption keys are secrets (anyone holding all three can push to that device), so they
# are encrypted at rest (ActiveRecord encryption); endpoint_digest is the unique, queryable
# stand-in for the endpoint. Per-category opt-outs live on the profile (push_preferences).
class CreatePushSubscriptions < ActiveRecord::Migration[8.1]
  def change
    create_table :push_subscriptions, id: :string do |t|
      t.string :user_id, null: false
      t.text :endpoint, null: false # encrypted
      t.string :endpoint_digest, null: false # SHA-256 hex of the endpoint
      t.text :p256dh, null: false # encrypted
      t.text :auth, null: false # encrypted
      t.string :user_agent_summary # e.g. "Chrome on Android"; never the raw user agent
      t.datetime :last_success_at
      t.datetime :last_failure_at
      t.integer :failure_count, null: false, default: 0
      t.timestamps
    end

    add_index :push_subscriptions, :endpoint_digest, unique: true
    add_index :push_subscriptions, :user_id
    add_foreign_key :push_subscriptions, :users

    add_column :profiles, :push_preferences, :jsonb, null: false, default: {}
  end
end
