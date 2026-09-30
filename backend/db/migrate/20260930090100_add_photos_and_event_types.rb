# Photo and event-type fields for the media kit.
#
# `photo_url` on profiles and acts holds the URL of an image the person uploaded (or the
# Google avatar copied in on connect); UserAvatar renders it and falls back to initials or
# generated art when blank. `event_types` on profiles mirrors acts.event_types (wedding,
# corporate, ...) and feeds the event-type filter.
#
# Lock profile: two nullable string columns and one defaulted jsonb column, all
# metadata-only on PostgreSQL 11+; no rewrite, no backfill.
class AddPhotosAndEventTypes < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :profiles, :photo_url, :string
    add_column :profiles, :event_types, :jsonb, null: false, default: []
    add_column :acts, :photo_url, :string
  end
end
