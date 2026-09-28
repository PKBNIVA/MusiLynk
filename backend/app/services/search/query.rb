module Search
  # A parsed search query, shared by global search and every list endpoint.
  #
  # Parsing lower-cases and strips punctuation, then reads the words left to right, taking the
  # longest known phrase (up to three words) from config/search_synonyms.yml first:
  #
  #   Query.new("Guitar players in Bombay").tokens
  #   # => [guitar player|guitarist|guitar  (a synonym group),
  #   #     mumbai|bombay                   (a city: matched against location fields only)]
  #
  # "in" is a stop word and "players" folds to "player". Words the vocabulary does not know match
  # as word prefixes ("drum" finds "Drummer"); vocabulary terms match as whole words, with an
  # optional plural ending.
  #
  # Matching is AND across tokens and OR within a token's alternatives (#condition). #score ranks
  # a row by where each token hit: title/headline 100, skills/roles 60, description/bio 30,
  # location 50, plus up to 20 for trigram similarity of the whole query to the title.
  class Query
    MAX_LENGTH = 100
    MAX_TOKENS = 8
    MAX_PHRASE_WORDS = 3
    MAX_INTERPRETED = 12
    EDGE_PUNCTUATION = /\A[-'&+#]+|[-'&+#]+\z/
    ASCII = /\A[ -~]+\z/
    # Characters people do not type into a music search but do type into injection probes. A query
    # containing them is matched exactly as typed: no spelling fixes and no partial matches.
    CODE_LIKE = /[;=<>{}\[\]$\\%_|`^~*]|--/

    # words: vocabulary alternatives, matched as whole words. prefixes: typed words, matched as
    # word prefixes. location: a city, matched against location fields.
    # known: the phrase is in the vocabulary (so it is never "corrected").
    Token = Data.define(:text, :words, :prefixes, :location, :known) do
      def initialize(text:, words:, prefixes:, location: false, known: true) = super
      def alternatives = (words + prefixes).uniq
      def location? = location
      def known? = known
    end

    # SQL text expressions by weight (columns, jsonb::text casts or scalar subqueries).
    Fields = Data.define(:primary, :secondary, :tertiary, :location) do
      def text = primary + secondary + tertiary
    end

    attr_reader :text, :tokens

    def self.parse(raw) = new(raw)

    def initialize(raw, tokens: nil)
      @typed = raw.to_s.strip.present?
      @natural = !raw.to_s.match?(CODE_LIKE)
      @text = self.class.normalize(raw)
      @tokens = tokens || tokenize(@text)
    end

    # Something was typed but nothing searchable is left ("%", "' OR '1'='1"): matches no rows.
    def inert? = @typed && tokens.empty?

    # Plain words (not code-like input): eligible for spelling fixes and partial matches.
    def natural? = @natural

    def self.normalize(raw)
      raw.to_s.scrub("").first(MAX_LENGTH).unicode_normalize(:nfkc).downcase
        .gsub(/\s&\s/, " and ")
        .gsub(/[^\p{L}\p{M}\p{N}\p{So}&+#'\-]+/, " ").squish
    end

    def blank? = tokens.empty?
    def multi? = tokens.size > 1

    # The query as read, then every alternative searched ("singer" → singer, vocalist, ...).
    def interpreted_as
      return [] if blank?
      [text, *tokens.flat_map(&:alternatives)].uniq.first(MAX_INTERPRETED)
    end

    # A copy of this query with one token replaced by the parse of `replacement`.
    def replace(token, replacement)
      replaced = tokens.flat_map { _1.equal?(token) ? self.class.new(replacement).tokens : [_1] }
      self.class.new(replaced.map(&:text).join(" "), tokens: replaced)
    end

    # Rows matching every token (mode :all), or at least one (mode :partial; a query with any
    # non-location words must then match one of those, so a bare city never fills the list).
    def condition(fields, mode: :all)
      if mode == :partial
        # Stray one- and two-letter fragments ("1" from "<script>alert(1)") never carry a partial match.
        pool = tokens.reject(&:location?).select { _1.known? || _1.text.length >= 3 }.presence || tokens
        "(#{pool.map { token_condition(_1, fields) }.join(' OR ')})"
      else
        "(#{tokens.map { token_condition(_1, fields) }.join(' AND ')})"
      end
    end

    # `scope` narrowed to rows matching every token; no rows for an inert query; unchanged when blank.
    # For structured filters (location, city, role), which never fall back to partial matches.
    def filter(scope, fields)
      return scope.none if inert?
      return scope if blank?
      scope.where(Arel.sql(condition(fields)))
    end

    # A single token's condition (used to find the words that match nothing).
    def token_condition(token, fields)
      columns = token.location? && fields.location.any? ? fields.location : fields.text + fields.location
      match(token, haystack(columns))
    end

    # A relevance score: every matched token adds 1,000 (so rows matching more words come first
    # in partial mode) plus its field weight, and trigram similarity to the title adds up to 20.
    # Weights use a plain substring test: the WHERE clause has already applied the exact match.
    def score(fields)
      parts = tokens.map do |token|
        if token.location?
          "(CASE WHEN #{contains(token, haystack(fields.location.presence || fields.text))} THEN 1050 ELSE 0 END)"
        else
          branches = [[fields.primary, 1100], [fields.secondary, 1060], [fields.tertiary + fields.location, 1030]]
          whens = branches.select { |columns, _| columns.any? }.map { |columns, weight| "WHEN #{contains(token, haystack(columns))} THEN #{weight}" }
          "(CASE #{whens.join(' ')} ELSE 0 END)"
        end
      end
      parts << "(20 * word_similarity(#{quote(text)}, COALESCE(#{fields.primary.first}, '')))" if fields.primary.any?
      parts.join(" + ")
    end

    private

    def tokenize(text)
      words = text.split(" ").map { _1.gsub(EDGE_PUNCTUATION, "") }.reject(&:empty?)
      tokens = []
      dropped = false
      index = 0
      while index < words.size && tokens.size < MAX_TOKENS
        token, used = phrase_at(words, index)
        if token
          tokens << token
          index += used
          next
        end
        word = words[index]
        index += 1
        next if words.size > 1 && Synonyms.stopword?(word)
        # A lone letter or digit ("1" from "1=1") narrows nothing.
        if word.length == 1 && word.match?(/[[:alnum:]]/)
          dropped = true
          next
        end
        tokens << plain(word)
      end
      return tokens if tokens.any? || dropped
      # Only stop words ("for"): search for them rather than for nothing.
      words.first(MAX_TOKENS).map { plain(_1) }
    end

    # The longest vocabulary phrase starting at words[index], as [token, words used].
    def phrase_at(words, index)
      [MAX_PHRASE_WORDS, words.size - index].min.downto(1) do |length|
        phrase = words[index, length].join(" ")
        [phrase, singular_phrase(phrase)].uniq.each do |candidate|
          if (city = Synonyms.city(candidate))
            return [Token.new(text: candidate, words: city, prefixes: [], location: true), length]
          end
          if (alternatives = Synonyms.expand(candidate))
            return [Token.new(text: candidate, words: alternatives, prefixes: [], location: false), length]
          end
        end
      end
      nil
    end

    # An unknown word matches as a word prefix ("drum" finds "Drummer"); a two-letter one only as a
    # whole word, so "ne" does not match every "new".
    def plain(word)
      return Token.new(text: word, words: [word], prefixes: [], known: false) if word.length < 3
      Token.new(text: word, words: [], prefixes: [word, self.class.singular(word)].uniq, known: false)
    end

    def singular_phrase(phrase)
      *head, last = phrase.split(" ")
      [*head, self.class.singular(last)].join(" ")
    end

    # English plural folding for the last word: singers → singer, classes → class, melodies → melody.
    def self.singular(word)
      return word if word.length < 4 || !word.match?(/\A[a-z]/) || word.end_with?("ss", "us", "is")
      return "#{word[0...-3]}y" if word.end_with?("ies")
      return word[0...-2] if word.match?(/(?:s|x|z|ch|sh)es\z/)
      return word[0...-1] if word.end_with?("s")
      word
    end

    # All `columns` as one text, so a token costs one regex per row rather than one per column.
    def haystack(columns) = columns.one? ? "COALESCE(#{columns.first}, '')" : "concat_ws(' ; ', #{columns.join(', ')})"

    # SQL: the token matches `expression`. ASCII alternatives become one case-insensitive regular
    # expression anchored at word starts; other scripts (e.g. Devanagari) use a substring match.
    def match(token, expression)
      regex, likes = pattern(token)
      conditions = []
      conditions << "#{expression} ~* #{regex}" if regex
      conditions << "lower(#{expression}) LIKE ANY (ARRAY[#{likes.join(', ')}])" if likes.any?
      "(#{conditions.join(' OR ')})"
    end

    # SQL: some alternative of the token occurs in `expression` (case-insensitive substring).
    def contains(token, expression)
      likes = token.alternatives.map { quote("%#{ActiveRecord::Base.sanitize_sql_like(_1)}%") }
      "(lower(#{expression}) LIKE ANY (ARRAY[#{likes.join(', ')}]))"
    end

    def pattern(token)
      @patterns ||= {}
      @patterns[token] ||= begin
        whole, prefix = [token.words, token.prefixes].map { |list| list.select { _1.match?(ASCII) } }
        # A word that ends in punctuation has no word end to anchor, so it matches as a prefix.
        prefix += whole.reject { _1.match?(/[[:alnum:]]\z/) }
        whole = whole.select { _1.match?(/[[:alnum:]]\z/) }
        patterns = []
        patterns << "\\m(?:#{whole.map { regex_escape(_1) }.join('|')})(?:s|es)?\\M" if whole.any?
        patterns << "\\m(?:#{prefix.uniq.map { regex_escape(_1) }.join('|')})" if prefix.any?
        likes = token.alternatives.reject { _1.match?(ASCII) }.map { quote("%#{ActiveRecord::Base.sanitize_sql_like(_1)}%") }
        [patterns.any? ? quote(patterns.join("|")) : nil, likes]
      end
    end

    # Escapes every character that is not a letter, digit or space for a PostgreSQL regex.
    def regex_escape(text) = text.gsub(/[^a-z0-9 ]/i) { "\\#{_1}" }

    def quote(value) = ActiveRecord::Base.lease_connection.quote(value)
  end
end
