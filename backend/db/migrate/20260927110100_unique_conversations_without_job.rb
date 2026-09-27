# The (candidate_id, employer_id, job_id) unique index treats NULL job_ids as distinct,
# so two concurrent requests could open two booking conversations for the same pair.
# Merge any existing duplicates into the oldest conversation, then add a partial
# unique index that covers job_id IS NULL.
class UniqueConversationsWithoutJob < ActiveRecord::Migration[8.1]
  def up
    execute <<~SQL
      CREATE TEMP TABLE conversation_merges ON COMMIT DROP AS
      SELECT id AS duplicate_id, keeper_id FROM (
        SELECT id, FIRST_VALUE(id) OVER (PARTITION BY candidate_id, employer_id ORDER BY created_at, id) AS keeper_id
        FROM conversations WHERE job_id IS NULL
      ) ranked
      WHERE id <> keeper_id;

      UPDATE messages SET conversation_id = m.keeper_id
      FROM conversation_merges m WHERE messages.conversation_id = m.duplicate_id;

      UPDATE notifications SET link = '/messages?c=' || m.keeper_id
      FROM conversation_merges m WHERE notifications.link = '/messages?c=' || m.duplicate_id;

      UPDATE conversations SET updated_at = GREATEST(conversations.updated_at, d.updated_at)
      FROM conversation_merges m JOIN conversations d ON d.id = m.duplicate_id
      WHERE conversations.id = m.keeper_id;

      DELETE FROM conversations USING conversation_merges m WHERE conversations.id = m.duplicate_id;
    SQL
    add_index :conversations, %i[candidate_id employer_id], unique: true, where: "job_id IS NULL",
              name: "index_conversations_on_pair_without_job"
  end

  def down
    remove_index :conversations, name: "index_conversations_on_pair_without_job"
  end
end
