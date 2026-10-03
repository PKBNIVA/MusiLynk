# R3 search: one denormalised search document per searchable row.
#
#   search_vector  tsvector, English stemming, weighted A (title / name / headline), B (roles, skills,
#                  instruments, genres, events, lineup), C (bio, description and the rest), D (location).
#                  GIN-indexed: every typed search matches and ranks on it.
#   search_text    the A, B and D fields as lower-case plain text, GIN trigram-indexed: substring
#                  matches for scripts the English parser does not split (Devanagari) and
#                  typo-tolerant word similarity for names and places.
#
# The columns are maintained by Search::Indexer (model callbacks) and filled for existing rows by
# SearchIndexBackfillJob in batches (enqueued by the next migration), never inline here.
# Indexes are built CONCURRENTLY so writes are not blocked while they build.
class AddSearchDocuments < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  TABLES = %i[profiles acts jobs portfolio_items].freeze

  def change
    TABLES.each do |table|
      add_column table, :search_vector, :tsvector, if_not_exists: true
      add_column table, :search_text, :text, if_not_exists: true
      add_index table, :search_vector, using: :gin, name: "index_#{table}_on_search_vector", algorithm: :concurrently, if_not_exists: true
      add_index table, :search_text, using: :gin, opclass: :gin_trgm_ops, name: "index_#{table}_on_search_text_trgm", algorithm: :concurrently, if_not_exists: true
    end
  end
end
