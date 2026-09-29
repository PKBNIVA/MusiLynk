# One row per lifecycle/digest/milestone email actually sent (LifecycleEmailsJob,
# WeeklyDigestJob, and the milestone sends in Notifier). The unique index on
# (user_id, key) is the idempotency guard: sending twice for the same key is a no-op.
#
# Lock profile: new table + indexes only.
class CreateLifecycleEmails < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    create_table :lifecycle_emails, id: :string do |t|
      t.string :user_id, null: false
      t.string :key, null: false
      t.datetime :sent_at, null: false
      t.datetime :created_at, null: false
    end

    add_index :lifecycle_emails, [:user_id, :key], unique: true, name: "index_lifecycle_emails_on_user_id_and_key"
    add_foreign_key :lifecycle_emails, :users, column: :user_id, on_delete: :cascade
  end
end
