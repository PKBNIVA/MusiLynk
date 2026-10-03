# Keeps a model's search document (Search::Document) current: after a save that created the row or
# changed one of `fields`, Search::Indexer rebuilds it with one UPDATE in the same transaction.
# The document columns are ignored by Active Record, so they are never loaded or serialised.
module SearchIndexed
  extend ActiveSupport::Concern

  DOCUMENT_COLUMNS = %w[search_vector search_text].freeze

  class_methods do
    def search_document(name, fields:, key: :id)
      self.ignored_columns += DOCUMENT_COLUMNS
      watched = fields.map(&:to_s).freeze
      after_save do
        Search::Indexer.refresh(name, public_send(key)) if previously_new_record? || saved_changes.keys.intersect?(watched)
      end
    end
  end
end
