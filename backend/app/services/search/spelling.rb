module Search
  # Typo tolerance for words that match too few rows (fewer than Settings.typo_min_results):
  #
  # * a word with a near vocabulary term (pg_trgm similarity >= Settings.spelling_threshold, fewest
  #   edits) also searches that term: "guitarst" → guitarist, reported as "did you mean";
  # * any other word also matches documents by trigram word similarity
  #   (>= Settings.fuzzy_word_threshold), which catches misspelt names and places.
  #
  # Known terms are the synonym vocabulary, the catalog taxonomy and the roles, skills, genres and
  # instruments people actually use (refreshed every REFRESH).
  module Spelling
    MIN_LENGTH = 4
    REFRESH = 10.minutes
    MAX_DB_TERMS = 5_000
    CANDIDATES = 8
    # Suggestions are remembered per word until the vocabulary refreshes (at most this many).
    MAX_CACHED = 2_000
    LOCK = Mutex.new

    # Terms people use, from the most recently updated rows of each source (reading every profile's
    # lists took 1.7 s at 50k profiles; the vocabulary file covers the common terms anyway).
    def self.db_terms_sql(rows)
      recent = ->(table, where = nil) { "(SELECT * FROM #{table} #{where} ORDER BY updated_at DESC LIMIT #{Integer(rows)}) #{table}" }
      <<~SQL.squish
        SELECT DISTINCT lower(term) FROM (
          SELECT jsonb_array_elements_text(skills) AS term FROM #{recent.('jobs', "WHERE status = 'published'")}
          UNION ALL SELECT genre FROM #{recent.('jobs', "WHERE status = 'published'")}
          UNION ALL SELECT jsonb_array_elements_text(roles || skills || instruments || genres) FROM #{recent.('profiles')}
          UNION ALL SELECT jsonb_array_elements_text(genres) FROM #{recent.('acts', "WHERE status = 'active'")}
          UNION ALL SELECT act_type FROM #{recent.('acts', "WHERE status = 'active'")}
        ) terms WHERE term IS NOT NULL AND length(term) BETWEEN 3 AND 40 LIMIT #{MAX_DB_TERMS}
      SQL
    end

    # The result of #widen: the widened query, and the corrected text to show as "did you mean"
    # (nil when only trigram matching was added).
    Widened = Data.define(:query, :did_you_mean)

    module_function

    # `query` with every unknown word that matches fewer than Settings.typo_min_results rows of
    # `scope` widened: it also searches its nearest vocabulary term, or else matches by trigram
    # word similarity. Returns a Widened, or nil when no word needed it. `exact_total` is the
    # whole query's count (enough for a one-word query, which then needs no count of its own).
    def widen(query, scope, target, exact_total:)
      minimum = Settings.typo_min_results
      tokens = []
      corrected = []
      query.tokens.each do |token|
        if token.known? || token.location? || token.text.length < MIN_LENGTH ||
            (query.tokens.one? ? exact_total : matches(scope, query, token, target, minimum)) >= minimum
          tokens << token
          corrected << token.text
          next
        end
        suggestion = suggest(token.text)
        replacement = Query.new(suggestion.to_s).tokens if suggestion && suggestion != token.text
        if replacement&.one?
          fixed = replacement.first
          tokens << fixed.with(words: (fixed.words + token.words).uniq, prefixes: (fixed.prefixes + token.prefixes).uniq)
          corrected << suggestion
        elsif replacement.present?
          tokens.concat(replacement)
          corrected << suggestion
        else
          tokens << token.with(fuzzy: token.text)
          corrected << token.text
        end
      end
      return nil if tokens == query.tokens
      text = corrected.join(" ")
      Widened.new(query: Query.new(text, tokens:), did_you_mean: text == query.text ? nil : text)
    end

    # How many rows of `scope` match `token`, counting no further than `minimum`.
    def matches(scope, query, token, target, minimum)
      scope.except(:select, :order, :includes, :preload, :eager_load).where(Arel.sql(query.token_condition(token, target))).limit(minimum).count
    end

    # The closest vocabulary term to `word`, or nil. pg_trgm finds the candidates at or above
    # THRESHOLD; the fewest edits wins (a missing letter is the commonest slip, so on a tie a term
    # at least as long as the word is preferred: "vocalst" → "vocalist", not "vocals").
    def suggest(word)
      vocabulary # refreshes the cache below when the vocabulary is rebuilt
      LOCK.synchronize { return @suggestions[word] if @suggestions&.key?(word) }
      suggestion = nearest(word)
      LOCK.synchronize do
        @suggestions = {} if @suggestions.nil? || @suggestions.size >= MAX_CACHED
        @suggestions[word] = suggestion
      end
    end

    def nearest(word)
      connection = ActiveRecord::Base.lease_connection
      terms = vocabulary.map { connection.quote(_1) }.join(",")
      quoted = connection.quote(word)
      candidates = connection.select_rows(<<~SQL.squish)
        SELECT term, similarity(term, #{quoted}) AS score FROM unnest(ARRAY[#{terms}]::text[]) AS term
        WHERE similarity(term, #{quoted}) >= #{Float(Settings.spelling_threshold)} ORDER BY score DESC, term ASC LIMIT #{CANDIDATES}
      SQL
      candidates.min_by { |term, score| [edit_distance(word, term), term.length < word.length ? 1 : 0, -score.to_f, term] }&.first
    end

    # Optimal string alignment distance (Levenshtein plus adjacent transpositions).
    def edit_distance(a, b)
      a = a.chars
      b = b.chars
      rows = Array.new(a.size + 1) { |i| Array.new(b.size + 1) { |j| i.zero? ? j : (j.zero? ? i : 0) } }
      (1..a.size).each do |i|
        (1..b.size).each do |j|
          cost = a[i - 1] == b[j - 1] ? 0 : 1
          rows[i][j] = [rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost].min
          rows[i][j] = [rows[i][j], rows[i - 2][j - 2] + 1].min if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]
        end
      end
      rows[a.size][b.size]
    end

    def vocabulary
      LOCK.synchronize do
        if @vocabulary.nil? || @loaded_at < REFRESH.ago
          @vocabulary = build_vocabulary
          @loaded_at = Time.current
          @suggestions = {}
        end
        @vocabulary
      end
    end

    def reset! = LOCK.synchronize { @vocabulary = @suggestions = nil }

    def build_vocabulary
      catalog = CatalogController::ROLE_CATEGORIES.values.flatten + CatalogController::INSTRUMENTS + CatalogController::ACT_TYPES +
        CatalogController::EVENT_TYPES + Taxonomy.function_areas + Taxonomy.talent_roles.values.flat_map { _1[:terms] }
      stored = ActiveRecord::Base.lease_connection.select_values(db_terms_sql(Settings.spelling_db_rows_per_source))
      phrases = (Synonyms.terms + catalog + stored).map { Query.normalize(_1) }
      words = phrases.flat_map { _1.split(" ") }
      (phrases + words).select { _1.length >= 3 }.uniq.freeze
    end
  end
end
