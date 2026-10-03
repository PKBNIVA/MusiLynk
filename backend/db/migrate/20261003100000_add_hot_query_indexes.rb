# Indexes for the filter shapes the hot list and search endpoints actually send, found with
# EXPLAIN (ANALYZE, BUFFERS) at seeded volume (docs/PERFORMANCE.md, "Query plans at volume").
#
# - Trigram indexes for the bare ILIKE filters that had none, so each read the whole table: the
#   talent facets (languages, eventType/open_to, genre, instrument cast to text), the acts eventType
#   facet, and profiles.location for the urgent-request candidate scope (`location ILIKE '%city%'`).
#   Search::Query's COALESCE/concat_ws matches cannot use any trigram index; that is the search
#   rework's to fix (see docs/PERFORMANCE.md), not an index's.
# - jobs: the newest-first browse order over published listings, so the first page reads 31 index
#   entries instead of sorting every published job.
# - portfolio_items: the "has a playable public sample" test the talent ranking runs for every
#   listed person, as an index-only scan.
#
# Built concurrently (no write lock on these tables during a deploy); reversible.
class AddHotQueryIndexes < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  TRIGRAM_COLUMNS = { profiles: %i[location] }.freeze
  TRIGRAM_JSONB = { profiles: %i[languages event_types open_to genres instruments], acts: %i[event_types] }.freeze
  SAMPLE_PREDICATE = "visibility = 'public' AND kind IN ('audio', 'video') AND btrim(COALESCE(url, '')) <> ''".freeze

  def up
    TRIGRAM_COLUMNS.each do |table, columns|
      columns.each do |column|
        add_index table, column, using: :gin, opclass: :gin_trgm_ops, name: "index_#{table}_on_#{column}_trgm", algorithm: :concurrently, if_not_exists: true
      end
    end
    TRIGRAM_JSONB.each do |table, columns|
      columns.each do |column|
        add_index table, "(#{column}::text) gin_trgm_ops", using: :gin, name: "index_#{table}_on_#{column}_text_trgm", algorithm: :concurrently, if_not_exists: true
      end
    end
    add_index :jobs, %i[published_at id], order: { published_at: "DESC NULLS LAST", id: :desc }, where: "status = 'published'",
      name: "index_jobs_published_browse", algorithm: :concurrently, if_not_exists: true
    add_index :portfolio_items, :user_id, where: SAMPLE_PREDICATE, name: "index_portfolio_items_playable_public", algorithm: :concurrently, if_not_exists: true
  end

  def down
    remove_index :portfolio_items, name: "index_portfolio_items_playable_public", algorithm: :concurrently, if_exists: true
    remove_index :jobs, name: "index_jobs_published_browse", algorithm: :concurrently, if_exists: true
    TRIGRAM_JSONB.each { |table, columns| columns.each { remove_index table, name: "index_#{table}_on_#{_1}_text_trgm", algorithm: :concurrently, if_exists: true } }
    TRIGRAM_COLUMNS.each { |table, columns| columns.each { remove_index table, name: "index_#{table}_on_#{_1}_trgm", algorithm: :concurrently, if_exists: true } }
  end
end
