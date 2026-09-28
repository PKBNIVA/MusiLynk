# "Need someone by tomorrow": tracks who UrgentMatcher/the founder notified about a request,
# and how it was closed, so the admin funnel (notified/responded/filled within 24h) and the
# hirer's live status card can be computed without re-deriving it from notifications.
#
# Lock profile: additive columns on a small table plus one new join table; nothing existing
# is rewritten. Rollback drops the new column/table set and restores the prior behaviour
# (notify without a record, no admin "filled by" attribution).
class AddMatchingToUrgentRequests < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :urgent_requests, :notified_count, :integer, null: false, default: 0
    add_column :urgent_requests, :first_notified_at, :datetime
    add_column :urgent_requests, :last_notified_at, :datetime
    add_column :urgent_requests, :filled_by_id, :string
    add_column :urgent_requests, :founder_notes, :text
    add_index :urgent_requests, :status
    add_index :urgent_requests, :start_at
    add_foreign_key :urgent_requests, :users, column: :filled_by_id

    create_table :urgent_request_notifications, id: :string do |t|
      t.string :urgent_request_id, null: false
      t.string :user_id, null: false
      # in_app | email | whatsapp
      t.string :channel, null: false
      # nil for the automatic UrgentMatcher pass; the admin's user id for a manual "Notify" click.
      t.string :notified_by_admin_id
      t.datetime :created_at, null: false
    end
    add_index :urgent_request_notifications, %i[urgent_request_id user_id channel], unique: true, name: "idx_urgent_notif_unique"
    add_index :urgent_request_notifications, :user_id
    add_foreign_key :urgent_request_notifications, :urgent_requests
    add_foreign_key :urgent_request_notifications, :users
    add_foreign_key :urgent_request_notifications, :users, column: :notified_by_admin_id
  end
end
