# A stored profile-view count for the "100 profile views" milestone email, so the milestone no
# longer depends on keeping every `profile_view` event forever (product_events now expire after
# 180 days, config/retention.yml). Backfilled from the events that exist today; EventsController
# increments it from now on. Reversible: down drops the column (the events still hold the history
# that is younger than the retention window).
class AddProfileViewCountToProfiles < ActiveRecord::Migration[8.1]
  def up
    add_column :profiles, :profile_view_count, :integer, default: 0, null: false
    execute <<~SQL
      UPDATE profiles SET profile_view_count = views.total
      FROM (
        SELECT props ->> 'profileId' AS profile_id, COUNT(*) AS total
        FROM product_events
        WHERE name = 'profile_view' AND props ->> 'profileId' IS NOT NULL
        GROUP BY 1
      ) views
      WHERE profiles.user_id = views.profile_id
    SQL
  end

  def down
    remove_column :profiles, :profile_view_count
  end
end
