# Fills search_vector / search_text for every existing row: enqueues SearchIndexBackfillJob, which
# works in batches of Search::Indexer::BATCH_SIZE rows, so the migration itself touches no data.
# Rolling back has nothing to undo (the previous migration's down drops the columns).
class EnqueueSearchBackfill < ActiveRecord::Migration[8.1]
  def up
    SearchIndexBackfillJob.perform_later
  end

  def down; end
end
