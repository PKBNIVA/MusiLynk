# Matching and the alert fan-out now run in UrgentMatchJob, not in the POST. match_status is the job's
# claim ("pending" -> "matching" -> "done", or "skipped" when the request closed first), so a retry or a
# duplicate enqueue cannot run it twice. Requests that already existed were matched inline: "done".
class AddMatchStateToUrgentRequests < ActiveRecord::Migration[8.1]
  def up
    add_column :urgent_requests, :match_status, :string, default: "pending", null: false
    add_column :urgent_requests, :matched_at, :datetime
    execute "UPDATE urgent_requests SET match_status = 'done', matched_at = COALESCE(first_notified_at, created_at)"
  end

  def down
    remove_column :urgent_requests, :matched_at
    remove_column :urgent_requests, :match_status
  end
end
