# "Verification shows what was verified": the admin now picks, on approval, which of a fixed
# set of checks (identity, work_links, credits, organization) were actually done, so the public
# Verified badge can say what it means instead of just showing a checkmark.
#
# Backfill: existing approved requests predate this and were all reviewed against the evidence
# link, so they are backfilled with checks: ["work_links"] — the closest honest description of
# what was actually checked at the time — rather than left blank (which the UI would otherwise
# render as "Verified by Verse" with no detail).
#
# Lock profile: additive column; the backfill UPDATE only touches already-approved rows.
class AddChecksToVerificationRequests < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    add_column :verification_requests, :checks, :jsonb, default: [], null: false
    execute <<~SQL
      UPDATE verification_requests SET checks = '["work_links"]'::jsonb WHERE status = 'approved'
    SQL
  end

  def down
    remove_column :verification_requests, :checks
  end
end
