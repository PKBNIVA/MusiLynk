# Verification::Tier counts the urgent requests a person filled (`status = 'filled' AND filled_by_id IN (...)`)
# for every verified card on the public directory page, and groups all filled requests by filled_by_id for the
# "Verified Pro" filter. Only `status` was indexed, so each lookup read every filled request. A partial index
# on the filled rows serves both: it is small (only filled requests) and ordered by the filler.
class AddFilledByIndexToUrgentRequests < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_index :urgent_requests, :filled_by_id, where: "status = 'filled'",
      name: "index_urgent_requests_on_filled_by_id_filled", algorithm: :concurrently, if_not_exists: true
  end
end
