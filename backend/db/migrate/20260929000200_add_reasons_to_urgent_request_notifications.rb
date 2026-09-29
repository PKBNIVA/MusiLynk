# "Why you were matched": UrgentMatcher already scores candidates; this persists the top three
# human-readable reasons for each alert actually sent, so the email and the request card can
# show them instead of a bare score.
#
# Lock profile: additive column only.
class AddReasonsToUrgentRequestNotifications < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :urgent_request_notifications, :reasons, :jsonb, default: [], null: false
  end
end
