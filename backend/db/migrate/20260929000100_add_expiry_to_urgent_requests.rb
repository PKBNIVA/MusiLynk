# "Requests never go silent": every urgent request now has an expiry so a hirer who never
# comes back to close it out doesn't leave respondents hanging forever. `expires_at` is set on
# create (see UrgentRequest#set_expiry) to UrgentConfig.expire_after_hours after creation, and
# the recurring UrgentRequestsSweepJob warns the hirer before it lapses and expires it after.
#
# Lock profile: additive columns only; nothing existing is rewritten.
class AddExpiryToUrgentRequests < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :urgent_requests, :expires_at, :datetime
    add_column :urgent_requests, :expiry_warned_at, :datetime
    add_index :urgent_requests, :expires_at
  end
end
