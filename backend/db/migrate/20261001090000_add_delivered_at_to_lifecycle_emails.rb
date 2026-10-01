# lifecycle_emails rows are claimed (sent_at) before the send job runs, so a row alone never
# proved delivery. `delivered_at` is set by LifecycleEmailDeliveryJob once the provider accepts
# the message; lifecycle:release_undelivered releases only rows where it is still NULL.
#
# Lock profile: one nullable timestamp column, metadata-only on PostgreSQL 11+; no rewrite and
# no backfill (rows from before this column cannot be told apart, so they stay NULL).
class AddDeliveredAtToLifecycleEmails < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :lifecycle_emails, :delivered_at, :datetime
  end
end
