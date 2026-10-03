module Search
  # Runs a query against a listing scope and returns one ranked page, with fallbacks so a
  # reasonable search is never a dead end:
  #
  # 1. "all":       rows matching every word, ranked by relevance (Query#score), then `order`.
  # 2. typo pass:   when that finds fewer than Settings.typo_min_results rows, words matching too
  #                 few rows also search their nearest vocabulary term ("guitarst" → "guitarist") or
  #                 match by trigram word similarity (Search::Spelling.widen). Rows matching the
  #                 query as typed stay first. Reported as "corrected" (with didYouMean) when the
  #                 exact pass found nothing.
  # 3. "partial":   when a multi-word query still matches nothing, rows matching some of the words,
  #                 those matching more words first.
  #
  # A typed search counts its matches while ranking them (#candidates); browsing (no query) counts
  # exactly up to Settings.count_cap and estimates past it (#total_for). The whole run
  # has Settings.statement_timeout_ms; a statement that runs out comes back as an empty result
  # rather than an error.
  class Runner
    # Candidate keys passed to the page query as a list up to this many (see #attempt).
    MAX_KEYS = 1_000
    def self.max_keys = MAX_KEYS

    Result = Data.define(:rows, :total, :more, :query, :mode, :did_you_mean) do
      def meta
        return {} if query.tokens.empty?
        { interpretedAs: query.interpreted_as, matchMode: mode, didYouMean: did_you_mean }.compact
      end
    end

    # `order` breaks score ties (and orders an empty query); it must end in a unique column.
    # `target` is a Search::Document (Search::Targets).
    def self.call(scope, raw, target, order:, offset: 0, limit: 30)
      new(scope, target, order, offset, limit).call(raw.is_a?(Query) ? raw : Query.new(raw))
    end

    def initialize(scope, target, order, offset, limit)
      @scope = scope
      @target = target
      @order = order.map { Arel.sql(_1) }
      @offset = offset
      @limit = limit
    end

    def call(query)
      return page(@scope.none, query, nil) if query.inert?
      @scope.klass.transaction(requires_new: true) do
        @scope.klass.lease_connection.select_value(
          "SELECT set_config('statement_timeout', #{Integer(Settings.statement_timeout_ms)}::text, true), " \
          "set_config('pg_trgm.word_similarity_threshold', #{Float(Settings.fuzzy_word_threshold)}::text, true)"
        )
        query.blank? ? page(@scope.reorder(*@order), query, nil) : search(query)
      end
    rescue ActiveRecord::QueryCanceled => e
      Rails.logger.warn("[search] #{@target.name} cancelled after #{Settings.statement_timeout_ms} ms: #{e.class}")
      Result.new(rows: [], total: 0, more: false, query:, mode: query.blank? ? nil : "all", did_you_mean: nil)
    end

    private

    def search(query)
      exact = attempt(query, :all, "all")
      return exact if exact.total >= Settings.typo_min_results || !query.natural?

      widened = Spelling.widen(query, @scope, @target, exact_total: exact.total)
      if widened
        # Rows matching as typed go first; with none there is nothing to boost.
        fixed = attempt(widened.query, :all, exact.total.zero? ? "corrected" : "all", widened.did_you_mean, boost: exact.total.zero? ? nil : query)
        return fixed if fixed.total > exact.total
      end
      return exact if exact.total.positive? || !query.multi?

      partial_query = widened&.query || query
      some = attempt(partial_query, :partial, "partial", widened&.did_you_mean)
      some.total.positive? ? some : exact
    end

    def attempt(query, match_mode, mode, did_you_mean = nil, boost: nil)
      filtered = @scope.where(Arel.sql(query.condition(@target, mode: match_mode)))
      score = Arel.sql(query.ranking(@target, boost:, mode: match_mode))
      keys, total, candidates = candidates(filtered, score)
      return Result.new(rows: [], total:, more: false, query:, mode:, did_you_mean:) if keys.empty?
      # A broad word can tie thousands of rows on the score; past MAX_KEYS the candidates go in as a
      # subquery rather than a list of keys.
      narrowed = keys.size <= self.class.max_keys ? @scope.where(@scope.klass.primary_key => keys) : @scope.where(Arel.sql(among(candidates)))
      rows = narrowed.reorder(score, *@order).offset(@offset).limit(@limit + 1).to_a
      Result.new(rows: rows.first(@limit), total:, more: rows.length > @limit, query:, mode:, did_you_mean:)
    end

    # One pass over the matching rows: their total, and the keys of the rows that can reach the page
    # (the first offset + limit + 1 by score and order.first, WITH TIES), so the rest of `order`,
    # which can be costly per row (the talent ranking runs two EXISTS per row), is computed for those
    # only. Every match has to be scored to rank them anyway, so the exact total costs nothing extra.
    # Returns [keys, total, the candidates' SQL (keys only)].
    def candidates(filtered, score)
      ranked = filtered.except(:select, :order, :includes, :preload, :eager_load, :offset, :limit).reorder(score, @order.first)
      ties = " FETCH FIRST #{Integer(@offset + @limit + 1)} ROWS WITH TIES"
      rows = @scope.klass.lease_connection.select_rows("#{ranked.select(Arel.sql("#{key_column}, COUNT(*) OVER ()")).to_sql}#{ties}")
      [rows.map(&:first), rows.first&.last.to_i, "#{ranked.select(Arel.sql(key_column)).to_sql}#{ties}"]
    end

    # SQL: the row's key is one of `candidates` (a subquery built from the query's own SQL).
    def among(candidates) = "#{key_column} IN (#{candidates})"

    def key_column
      klass = @scope.klass
      "#{klass.quoted_table_name}.#{klass.lease_connection.quote_column_name(klass.primary_key)}"
    end

    # An empty query (browse): the scope in `order`, with a capped total.
    def page(ordered, query, mode, did_you_mean = nil)
      rows = ordered.offset(@offset).limit(@limit + 1).to_a
      more = rows.length > @limit
      total = more || (rows.empty? && @offset.positive?) ? total_for(ordered) : @offset + rows.length
      Result.new(rows: rows.first(@limit), total:, more:, query:, mode:, did_you_mean:)
    end

    # Exact up to Settings.count_cap (a LIMITed count); past it the planner's row estimate, rounded
    # to two significant figures and never below the cap.
    def total_for(relation)
      cap = Settings.count_cap
      matching = relation.except(:select, :order, :includes, :preload, :eager_load, :offset, :limit)
      counted = matching.limit(cap + 1).count
      return counted if counted <= cap
      plan = @scope.klass.lease_connection.select_value("EXPLAIN (FORMAT JSON) #{matching.select(Arel.sql('1')).to_sql}")
      estimate = JSON.parse(plan).dig(0, "Plan", "Plan Rows").to_i
      [estimate.round(-[estimate.to_s.length - 2, 0].max), cap].max
    end
  end
end
