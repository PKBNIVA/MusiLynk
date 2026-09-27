# Rolling per-minute request counters for the admin Operations view (request count,
# 5xx count and a latency histogram for the p95). Each web process buffers counts in
# memory and adds them here every few seconds; rows older than 25 hours are deleted
# on every write, so the table never holds more than about 1,500 rows.
#
# Lock profile: a new, empty table plus its index; nothing existing is locked except
# the catalog, and lock_timeout makes the migration fail fast rather than queue.
#
# Rollback (`bin/rails db:migrate:down VERSION=20260927163000`) drops the table; the
# Operations view then shows no request metrics and request handling is unaffected
# (a failed metrics write is logged and dropped).
class CreateRequestMetricMinutes < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    create_table :request_metric_minutes, id: false do |t|
      t.datetime :minute, null: false
      t.integer :requests, null: false, default: 0
      t.integer :server_errors, null: false, default: 0
      # Counts per latency bucket; the bucket edges are RequestMetric::LATENCY_BOUNDS_MS
      # plus one overflow bucket.
      t.integer :latency_histogram, array: true, null: false, default: []
    end
    add_index :request_metric_minutes, :minute, unique: true
  end
end
