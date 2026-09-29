# Granular email opt-outs shown on the "Manage emails" page (linked from every lifecycle,
# digest and milestone email's footer). `email_notifications` stays the master switch;
# these four categories only ever narrow what the master switch already allows through.
#
# Lock profile: new column only.
class AddEmailPreferencesToProfiles < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :profiles, :email_preferences, :jsonb, null: false,
      default: { digest: true, lifecycle: true, requests: true, product: true }
  end
end
