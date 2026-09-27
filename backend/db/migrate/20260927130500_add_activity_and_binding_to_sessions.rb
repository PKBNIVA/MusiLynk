# Sessions slide forward while they are used (idle expiry) up to a hard cap, and
# remember a coarse fingerprint of the browser that created them so a token
# replayed from a different browser can be detected.
class AddActivityAndBindingToSessions < ActiveRecord::Migration[8.1]
  def change
    add_column :sessions, :last_seen_at, :datetime
    add_column :sessions, :absolute_expires_at, :datetime
    add_column :sessions, :client_fingerprint, :string
    add_column :sessions, :flagged_at, :datetime
  end
end
