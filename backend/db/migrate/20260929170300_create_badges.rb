# A small, timestamped award shown as a chip on a profile/talent card (currently just
# fast_responder_week — FastResponderWeekJob). Unique per (user, kind, awarded_for) so the
# weekly job is idempotent if it ever re-runs for the same ISO week.
class CreateBadges < ActiveRecord::Migration[8.1]
  def change
    create_table :badges, id: :string do |t|
      t.string :user_id, null: false
      t.string :kind, null: false
      t.string :awarded_for, null: false # e.g. an ISO week "2026-W40"
      t.string :city # denormalized context for the kind, when relevant
      t.timestamps
    end

    add_index :badges, %i[user_id kind awarded_for], unique: true, name: "index_badges_on_user_kind_period"
    add_index :badges, %i[kind awarded_for]
    add_foreign_key :badges, :users
  end
end
