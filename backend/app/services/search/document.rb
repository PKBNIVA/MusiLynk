module Search
  # A searchable entity's denormalised search document: which columns hold it, how it is built, and
  # the SQL that rebuilds it (Search::Indexer). See db/migrate/20261003120000_add_search_documents.rb.
  #
  # Weights: A title / name / headline, B roles, skills, instruments, genres, events, lineup,
  # C bio, description and the rest, D location. A query's city words match D only.
  #
  # name             the result type ("talent", "acts", ...)
  # table / key      the table holding search_vector / search_text, and its primary key
  # vector / text    the columns a typed query matches (qualified, as the search scopes use them)
  # title            SQL for the row's title, for the "whole query looks like the title" bonus
  # location_vector  the tsvector whose D lexemes are the row's location (a work sample has none of
  #                  its own: it is the owner's profile document; scopes must join it)
  # location_text    the matching plain text, for city names in other scripts
  # sources          FROM / WHERE extras the rebuild joins (e.g. users for a profile's name)
  # weights          { "A" => [sql, ...], ... } the fields of each weight
  Document = Data.define(:name, :table, :key, :title, :location_vector, :location_text, :sources, :weights) do
    def vector = "#{table}.search_vector"
    def text = "#{table}.search_text"

    # SQL that rebuilds the document of the rows whose key is in `ids_sql` (a subquery or list).
    def refresh_sql(ids_sql)
      joins, condition = sources
      from = joins.any? ? " FROM #{joins.join(', ')}" : ""
      "UPDATE #{table} SET search_vector = #{vector_sql}, search_text = #{text_sql}#{from} " \
        "WHERE #{[*condition, "#{table}.#{key} IN (#{ids_sql})"].join(' AND ')}"
    end

    def vector_sql
      weights.map { |weight, fields| "setweight(to_tsvector('#{Document::CONFIG}'::regconfig, #{concat(fields)}), '#{weight}')" }.join(" || ")
    end

    # Titles, skills and location only (not bios and descriptions): the plain text serves name and
    # place typos and other scripts, and keeping it short keeps the rows a search reads small.
    def text_sql = "lower(#{concat(weights.except('C').values.flatten)})"

    private

    def concat(fields) = "concat_ws(' ', #{fields.join(', ')})"
  end

  class Document
    # Text search configuration: English stemming folds plurals and -ing forms on both sides
    # ("singers" → singer, "drums" → drum) while "dhol" and "dholak" stay different words.
    CONFIG = "english".freeze

    # A jsonb list as plain words (its JSON punctuation blanked).
    def self.list(column) = "translate(#{column}::text, '[]\",', '    ')"
  end
end
