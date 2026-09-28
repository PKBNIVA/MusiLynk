module Search
  # "Did you mean" for words that match nothing: the nearest known term by pg_trgm similarity.
  # Known terms are the synonym vocabulary, the catalog taxonomy and the roles, skills, genres and
  # instruments people actually use (refreshed every REFRESH).
  module Spelling
    THRESHOLD = 0.4
    MIN_LENGTH = 4
    REFRESH = 10.minutes
    MAX_DB_TERMS = 5_000
    CANDIDATES = 8
    # Suggestions are remembered per word until the vocabulary refreshes (at most this many).
    MAX_CACHED = 2_000
    LOCK = Mutex.new

    DB_TERMS_SQL = <<~SQL.squish.freeze
      SELECT DISTINCT lower(term) FROM (
        SELECT jsonb_array_elements_text(skills) AS term FROM jobs WHERE status = 'published'
        UNION ALL SELECT genre FROM jobs WHERE status = 'published'
        UNION ALL SELECT jsonb_array_elements_text(roles) FROM profiles
        UNION ALL SELECT jsonb_array_elements_text(skills) FROM profiles
        UNION ALL SELECT jsonb_array_elements_text(instruments) FROM profiles
        UNION ALL SELECT jsonb_array_elements_text(genres) FROM profiles
        UNION ALL SELECT jsonb_array_elements_text(genres) FROM acts WHERE status = 'active'
        UNION ALL SELECT act_type FROM acts WHERE status = 'active'
      ) terms WHERE term IS NOT NULL AND length(term) BETWEEN 3 AND 40 LIMIT #{MAX_DB_TERMS}
    SQL

    module_function

    # A copy of `query` with each unknown word that matches nothing in `scope` replaced by its
    # nearest known term, or nil when nothing could be corrected.
    def correct(query, scope, fields)
      corrected = query
      query.tokens.each do |token|
        next if token.known? || token.location? || token.text.length < MIN_LENGTH
        next if scope.where(Arel.sql(query.token_condition(token, fields))).exists?
        suggestion = suggest(token.text)
        corrected = corrected.replace(token, suggestion) if suggestion && suggestion != token.text
      end
      corrected.equal?(query) ? nil : corrected
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
        WHERE similarity(term, #{quoted}) >= #{THRESHOLD} ORDER BY score DESC, term ASC LIMIT #{CANDIDATES}
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
      stored = ActiveRecord::Base.lease_connection.select_values(DB_TERMS_SQL)
      phrases = (Synonyms.terms + catalog + stored).map { Query.normalize(_1) }
      words = phrases.flat_map { _1.split(" ") }
      (phrases + words).select { _1.length >= 3 }.uniq.freeze
    end
  end
end
