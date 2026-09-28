module Search
  # Runs a query against a listing scope and returns one ranked page, with fallbacks so a
  # reasonable search is never a dead end:
  #
  # 1. "all":       rows matching every word (ranked by Query#score).
  # 2. "corrected": when nothing matches, misspelt words are replaced by the nearest known term
  #                 ("guitarst" → "guitarist") and the response says so (didYouMean).
  # 3. "partial":   when a multi-word query still matches nothing, rows matching some of the words,
  #                 those matching more words first.
  #
  # Each attempt is one query: the page plus `COUNT(*) OVER ()` for the total.
  class Runner
    Result = Data.define(:rows, :total, :more, :query, :mode, :did_you_mean) do
      def meta
        return {} if query.tokens.empty?
        { interpretedAs: query.interpreted_as, matchMode: mode, didYouMean: did_you_mean }.compact
      end
    end

    # `order` breaks score ties (and orders an empty query); it must end in a unique column.
    def self.call(scope, raw, fields, order:, offset: 0, limit: 30)
      new(scope, fields, order, offset, limit).call(raw.is_a?(Query) ? raw : Query.new(raw))
    end

    def initialize(scope, fields, order, offset, limit)
      @scope = scope
      @fields = fields
      @order = order.map { Arel.sql(_1) }
      @offset = offset
      @limit = limit
    end

    def call(query)
      return page(@scope.none, query, nil) if query.inert?
      return page(@scope.reorder(*@order), query, nil) if query.blank?

      exact = attempt(query, :all, "all")
      return exact if exact.total.positive? || !query.natural?

      if (corrected = Spelling.correct(query, @scope, @fields))
        fixed = attempt(corrected, :all, "corrected", corrected.text)
        return fixed if fixed.total.positive?
        query = corrected if corrected.multi?
      end
      if query.multi?
        some = attempt(query, :partial, "partial", corrected&.text)
        return some if some.total.positive?
      end
      exact
    end

    private

    def attempt(query, match_mode, mode, did_you_mean = nil)
      filtered = @scope.where(Arel.sql(query.condition(@fields, mode: match_mode)))
      base = filtered.select_values.empty? ? filtered.select(filtered.klass.arel_table[Arel.star]) : filtered
      ranked = base.select(Arel.sql("(#{query.score(@fields)}) AS search_score")).reorder(Arel.sql("search_score DESC"), *@order)
      page(ranked, query, mode, did_you_mean)
    end

    def page(ordered, query, mode, did_you_mean = nil)
      base = ordered.select_values.empty? ? ordered.select(ordered.klass.arel_table[Arel.star]) : ordered
      rows = base.select(Arel.sql("COUNT(*) OVER () AS search_total")).offset(@offset).limit(@limit + 1).to_a
      total = rows.first ? rows.first[:search_total].to_i : count(ordered)
      Result.new(rows: rows.first(@limit), total:, more: rows.length > @limit, query:, mode:, did_you_mean:)
    end

    # Only needed past the last row (an offset beyond the end has no row to carry the total).
    def count(ordered) = @offset.zero? ? 0 : ordered.except(:select, :order, :includes, :preload, :eager_load).count
  end
end
