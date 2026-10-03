# Indexes for the nightly retention sweep (RetentionSweepJob): it deletes product_events by
# created_at and read notifications by read_at, 1,000 rows at a time. Without these each batch
# was a sequential scan of the whole table. Built concurrently (no write lock); reversible.
class AddRetentionSweepIndexes < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_index :product_events, :created_at, algorithm: :concurrently, if_not_exists: true
    add_index :notifications, :read_at, where: "read_at IS NOT NULL", name: "index_notifications_on_read_at_when_read", algorithm: :concurrently, if_not_exists: true
  end
end
