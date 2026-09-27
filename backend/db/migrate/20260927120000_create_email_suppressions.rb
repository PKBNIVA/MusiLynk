# Addresses the email provider reported as undeliverable (hard bounce, blocked), as
# complaining (marked spam), or as unsubscribed. EmailDelivery and NotificationEmail
# consult it before sending, so Verse stops emailing an address that would hurt the
# sending domain's reputation.
#
# Lock profile: a new, empty table plus its indexes; nothing existing is locked except
# the catalog, and lock_timeout makes the migration fail fast rather than queue.
#
# Rollback (`bin/rails db:migrate:down VERSION=20260927120000`) drops the table; every
# address is then emailed again, as before this release.
class CreateEmailSuppressions < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    create_table :email_suppressions, id: :string do |t|
      t.string :email, null: false
      # "all" blocks every email; "notifications" only blocks notification emails;
      # "none" is a soft bounce that is recorded for visibility but still delivered.
      t.string :scope, null: false, default: "none"
      t.string :reason, null: false
      t.string :provider, null: false, default: "brevo"
      t.integer :soft_bounce_count, null: false, default: 0
      t.string :last_event, null: false
      t.string :last_message_id
      t.datetime :last_event_at, null: false
      t.datetime :suppressed_at
      t.timestamps
    end
    add_index :email_suppressions, :email, unique: true
    add_index :email_suppressions, :scope
  end
end
