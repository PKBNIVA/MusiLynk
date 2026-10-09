# R4: the talent directory's ranking signals (verified, playable sample, completeness, rates, recent
# sign-in) precomputed into profiles.rank_score so the list reads its first page off an index instead
# of scoring and sorting every row per request, and so pages can be keyset-paged on (rank_score, user_id).
# Also indexes notifications for keyset paging on (created_at, id) per user.
# Reversible: down drops the column and indexes; no existing data is changed.
class AddRankScoreToProfiles < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    add_column :profiles, :rank_score, :integer, null: false, default: 0 unless column_exists?(:profiles, :rank_score)
    add_index :profiles, %i[rank_score user_id], order: { rank_score: :desc, user_id: :desc },
      name: "index_profiles_on_rank_score_and_user_id", algorithm: :concurrently, if_not_exists: true
    add_index :notifications, %i[user_id created_at id], order: { created_at: :desc, id: :desc },
      name: "index_notifications_on_user_id_and_created_at_and_id", algorithm: :concurrently, if_not_exists: true
    # Backfill in one statement (TalentRank::UPDATE_SQL, the same expression the callbacks and the
    # nightly TalentRankJob use).
    execute TalentRank.update_sql
  end

  def down
    remove_index :notifications, name: "index_notifications_on_user_id_and_created_at_and_id", if_exists: true
    remove_index :profiles, name: "index_profiles_on_rank_score_and_user_id", if_exists: true
    remove_column :profiles, :rank_score if column_exists?(:profiles, :rank_score)
  end
end
