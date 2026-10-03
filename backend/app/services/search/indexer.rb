module Search
  # Keeps each searchable row's search document (search_vector, search_text; see Search::Document)
  # in step with the row. Models call `refresh` after a save that touched a searched field; one
  # UPDATE rebuilds the document from the row (and its user or lineup) in SQL.
  # SearchIndexBackfillJob fills existing rows in batches with `backfill`.
  module Indexer
    BATCH_SIZE = 1_000
    DOCUMENTS = Targets::ALL.index_by(&:name).freeze

    module_function

    # Rebuilds the documents of `ids` (keys of the document's table). Returns the rows updated.
    def refresh(name, ids)
      ids = Array(ids).compact.uniq
      return 0 if ids.empty?
      connection = ActiveRecord::Base.lease_connection
      # `update` (not exec_update) also clears the query cache, so a later read in the request sees it.
      connection.update(DOCUMENTS.fetch(name).refresh_sql(ids.map { connection.quote(_1) }.join(", ")), "Search::Indexer")
    end

    # Rebuilds documents in batches of `batch_size` keys, in key order. `missing_only` skips rows
    # that already have one (the nightly sweep for rows written without callbacks, e.g. insert_all).
    # Each batch is its own statement, so a long backfill never holds one long transaction.
    def backfill(name, batch_size: BATCH_SIZE, missing_only: false)
      document = DOCUMENTS.fetch(name)
      connection = ActiveRecord::Base.lease_connection
      key = "#{document.table}.#{document.key}"
      after = nil
      updated = 0
      loop do
        conditions = []
        conditions << "#{document.table}.search_vector IS NULL" if missing_only
        conditions << "#{key} > #{connection.quote(after)}" if after
        where = conditions.any? ? "WHERE #{conditions.join(' AND ')}" : ""
        ids = connection.select_values("SELECT #{key} FROM #{document.table} #{where} ORDER BY #{key} LIMIT #{Integer(batch_size)}")
        break if ids.empty?
        updated += refresh(name, ids)
        after = ids.last
      end
      updated
    end
  end
end
