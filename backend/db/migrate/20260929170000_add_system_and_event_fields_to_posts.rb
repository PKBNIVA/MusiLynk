# The Stage gets a system author ("Verse") plus meetup/event posts:
#  - system_kind: which recurring event a system post represents (nil for ordinary posts).
#  - system_ref: a unique idempotency key so StageSystemPostsJob never posts the same event twice.
#  - pinned_until: admin (or the weekly system job) can pin a post to the top of the feed until
#    this time; the feed orders pinned-and-current posts first (Post.pinned_first scope).
#  - event_title/event_starts_at/event_venue: the `event` post kind's own fields (city and a
#    link already exist on posts).
#  - featured: admin can feature an event so it is prioritised in the "Upcoming in <city>" strip.
#
# created_by_user_id is relaxed to nullable because system posts have no real author — they use
# author_type "system" (see Post::AUTHOR_TYPES) and no created_by_user_id at all.
class AddSystemAndEventFieldsToPosts < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    change_column_null :posts, :created_by_user_id, true

    add_column :posts, :system_kind, :string
    add_column :posts, :system_ref, :string
    add_column :posts, :pinned_until, :datetime
    add_column :posts, :event_title, :string
    add_column :posts, :event_starts_at, :datetime
    add_column :posts, :event_venue, :string
    add_column :posts, :featured, :boolean, null: false, default: false

    add_index :posts, :system_ref, unique: true
    add_index :posts, :pinned_until
    add_index :posts, :event_starts_at
  end
end
