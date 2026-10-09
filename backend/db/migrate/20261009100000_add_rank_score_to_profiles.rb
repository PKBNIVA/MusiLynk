# R4: the talent directory's ranking signals (verified, playable sample, completeness, rates, recent
# sign-in) precomputed into profiles.rank_score so the list reads its first page off an index instead
# of scoring and sorting every row per request, and so pages can be keyset-paged on (rank_score, user_id).
# Also indexes notifications for keyset paging on (created_at, id) per user.
# Reversible: down drops the column and indexes; no existing data is changed. The backfill runs in id batches.
class AddRankScoreToProfiles < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  BACKFILL_BATCH = 1_000

  def up
    add_column :profiles, :rank_score, :integer, null: false, default: 0 unless column_exists?(:profiles, :rank_score)
    add_index :profiles, %i[rank_score user_id], order: { rank_score: :desc, user_id: :desc },
      name: "index_profiles_on_rank_score_and_user_id", algorithm: :concurrently, if_not_exists: true
    add_index :notifications, %i[user_id created_at id], order: { created_at: :desc, id: :desc },
      name: "index_notifications_on_user_id_and_created_at_and_id", algorithm: :concurrently, if_not_exists: true
    # Backfill in id ranges of BACKFILL_BATCH profiles per statement (one UPDATE over every profile held
    # row locks for 26 s at 55k profiles). The SQL is frozen here, not read from TalentRank, so a later
    # change to the app's ranking cannot change what this migration does; the nightly TalentRankJob
    # re-scores with whatever TalentRank holds then.
    last = nil
    loop do
      ids = select_values("SELECT user_id FROM profiles#{" WHERE user_id > #{quote(last)}" if last} ORDER BY user_id LIMIT #{BACKFILL_BATCH}")
      break if ids.empty?
      execute backfill_sql(ids.first, ids.last)
      last = ids.last
    end
  end

  def down
    remove_index :notifications, name: "index_notifications_on_user_id_and_created_at_and_id", if_exists: true
    remove_index :profiles, name: "index_profiles_on_rank_score_and_user_id", if_exists: true
    remove_column :profiles, :rank_score if column_exists?(:profiles, :rank_score)
  end

  private

  # Frozen copy of the R4 ranking: verified 10000, playable public sample 1000, completeness (0-6) x 100,
  # any published rate 10, sign-in within 7/30/90 days 3/2/1.
  def backfill_sql(first_id, last_id)
    score = <<~SQL.squish
      ((CASE WHEN profiles.verified THEN 10000 ELSE 0 END)
      + (CASE WHEN EXISTS (SELECT 1 FROM portfolio_items ranked_samples WHERE ranked_samples.user_id = profiles.user_id AND ranked_samples.visibility = 'public' AND ranked_samples.kind IN ('audio', 'video') AND btrim(COALESCE(ranked_samples.url, '')) <> '') THEN 1000 ELSE 0 END)
      + ((CASE WHEN btrim(COALESCE(profiles.headline, '')) <> '' THEN 1 ELSE 0 END)
        + (CASE WHEN btrim(COALESCE(profiles.bio, '')) <> '' THEN 1 ELSE 0 END)
        + (CASE WHEN btrim(COALESCE(profiles.location, '')) <> '' THEN 1 ELSE 0 END)
        + (CASE WHEN profiles.skills <> '[]'::jsonb THEN 1 ELSE 0 END)
        + (CASE WHEN profiles.genres <> '[]'::jsonb THEN 1 ELSE 0 END)
        + (CASE WHEN EXISTS (SELECT 1 FROM portfolio_items scored_items WHERE scored_items.user_id = profiles.user_id) THEN 1 ELSE 0 END)) * 100
      + (CASE WHEN LEAST(NULLIF(profiles.session_rate, 0), NULLIF(profiles.show_rate, 0), NULLIF(profiles.day_rate, 0), NULLIF(profiles.hourly_rate, 0)) IS NOT NULL THEN 10 ELSE 0 END)
      + (CASE WHEN users.last_login_at >= NOW() - INTERVAL '7 days' THEN 3 WHEN users.last_login_at >= NOW() - INTERVAL '30 days' THEN 2 WHEN users.last_login_at >= NOW() - INTERVAL '90 days' THEN 1 ELSE 0 END))
    SQL
    "UPDATE profiles SET rank_score = #{score} FROM users WHERE users.id = profiles.user_id " \
      "AND profiles.user_id BETWEEN #{quote(first_id)} AND #{quote(last_id)} AND profiles.rank_score IS DISTINCT FROM #{score}"
  end
end
