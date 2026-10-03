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
  # as word prefixes when they are long enough ("drumm" finds "Drummer"; Settings.prefix_min_length)
  # and whole otherwise; vocabulary terms match as whole words (stemmed, so plurals match).
  #
  # Matching is AND across tokens and OR within a token's alternatives (#condition), against a
  # Search::Document: a token becomes one full-text query on the row's weighted search_vector, which
  # a GIN index serves. A phrase matches its words anywhere in the row; vocabulary terms and short words match
  # whole words (English stemming folds plurals, so "singers" finds "Singer" but "dhol" never finds
  # "dholak"); longer unknown words also match as word prefixes; a city matches the location (D)
  # only. Devanagari spellings (गायक) are words like any other; alternatives with symbols ("a&r")
  # or emoji match search_text by substring (trigram index).
  #
  # #score ranks a row by where each token hit: title/name/headline (A) 1100, roles/skills (B) 1060,
  # anywhere else 1030, a city 1050; plus 100 when a typed phrase is there in order, 10 when the word
  # itself (not only a synonym) is there, and up to 20 for trigram similarity of the whole query to
  # the title (rows whose title matched). Every matched token adds at least 1,000, so in partial
  # mode rows matching more words lead.
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
    # word prefixes. location: a city, matched against the location (weight D) only.
    # known: the phrase is in the vocabulary (so it is never "corrected").
    # weights: restricts a document match to these weights ("D" for a city, "AB" for a role filter).
    # fuzzy: a word also matched by trigram word similarity (typo tolerance, see Search::Spelling).
    Token = Data.define(:text, :words, :prefixes, :location, :known, :weights, :fuzzy) do
      def initialize(text:, words:, prefixes:, location: false, known: true, weights: nil, fuzzy: nil)
        super(text:, words:, prefixes:, location:, known:, weights: weights || (location ? "D" : nil), fuzzy:)
      end
      def alternatives = (words + prefixes).uniq
      def location? = location
      def known? = known
    end

    attr_reader :text, :tokens

    def self.parse(raw) = new(raw)

    # One query that matches rows matching ANY of `raws` (for example a musician's roles).
    # Single-word roles fold into one token whose alternatives are OR-ed; a role of several words
    # that is not a known phrase is matched as that exact phrase, so "sound engineer" is never
    # split into "sound" OR "engineer". Roles that parse to nothing are ignored; if none are left
    # the result is the (inert) query of what was typed.
    def self.any_of(raws)
      raws = Array(raws)
      queries = raws.map { new(_1) }.reject(&:blank?)
      return new(raws.join(" ")) if queries.empty?
      return queries.first if queries.one?

      words = []
      prefixes = []
      queries.each do |query|
        token = query.tokens.first
        if query.tokens.one? && !token.location?
          words.concat(token.words)
          prefixes.concat(token.prefixes)
        else
          words << query.text
        end
      end
      text = queries.map(&:text).join(" or ")
      new(text, tokens: [Token.new(text:, words: words.uniq, prefixes: prefixes.uniq)])
    end

    def initialize(raw, tokens: nil)
      @typed = raw.to_s.strip.present?
      @natural = !raw.to_s.match?(CODE_LIKE)
      @text = self.class.normalize(raw)
      @tokens = tokens || tokenize(@text)
    end

    # Rows must match this query and `other` (used to narrow a typed search by roles).
    def and(other)
      return self if inert?
      return other if other.inert? || blank?
      return self if other.blank?

      self.class.new([text, other.text].join(" "), tokens: tokens + other.tokens)
    end

    # This query with each word that is the narrower term of a one-way expansion ("hindustani" under
    # "classical") also searching the broader term and its spellings (not everything the broader
    # term itself expands to, so "dhol" never reaches dholak players this way), or nil when no word has one. The fallback for
    # a query that matches too few rows (Search::Runner).
    def broaden
      broadened = tokens.map do |token|
        parents = token.location? ? [] : Synonyms.parents(token.text)
        next token if parents.empty?
        token.with(words: (token.words + parents.flat_map { Synonyms.group(_1) }).uniq)
      end
      return nil if broadened == tokens
      dup.tap { _1.retoken(broadened) }
    end

    # This query with every word matched against the location only (a "location" filter box).
    def as_location = restrict("D", location: true)

    # This query with every word restricted to the given document weights (e.g. "AB" for a role filter).
    # The copy keeps what was typed, so an inert filter ("%") stays inert.
    def restrict(weights, location: false)
      dup.tap { _1.retoken(tokens.map { |token| token.with(weights:, location: location || token.location?) }) }
    end

    protected

    def retoken(tokens)
      @tokens = tokens
      @tsqueries = nil
    end

    public

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
    # `target` is a Search::Document (Search::Targets).
    def condition(target, mode: :all)
      if mode == :partial
        # Stray one- and two-letter fragments ("1" from "<script>alert(1)") never carry a partial match.
        pool = tokens.reject(&:location?).select { _1.known? || _1.text.length >= 3 }.presence || tokens
        "(#{pool.map { token_condition(_1, target) }.join(' OR ')})"
      else
        "(#{tokens.map { token_condition(_1, target) }.join(' AND ')})"
      end
    end

    # `scope` narrowed to rows matching every token; no rows for an inert query; unchanged when blank.
    # For structured filters (location, city, role), which never fall back to partial matches.
    def filter(scope, target)
      return scope.none if inert?
      return scope if blank?
      scope.where(Arel.sql(condition(target)))
    end

    # A single token's condition (used to find the words that match nothing).
    def token_condition(token, target) = document_condition(token, target)

    # A relevance score (see the class comment). `boost` (the query as typed, when this one was
    # widened by a spelling fix) adds 500 to rows matching it, so exact matches stay ahead.
    # `mode` is the match mode the rows were selected with (#condition).
    def score(target, boost: nil, mode: :partial) = document_score(target, boost, mode == :all)

    # The score as an ORDER BY term, best first.
    def ranking(target, boost: nil, mode: :partial) = "(#{score(target, boost:, mode:)}) DESC"

    # The tsquery an alternative list becomes, as SQL (nil when no alternative is a plain word), and
    # the alternatives matched by substring instead (symbols such as "a&r", emoji).
    # Whole words and phrases go through the English stemmer like the documents. A prefix is matched
    # unstemmed against the documents' stems ("drumm" finds 'drummer') and also as a whole stemmed
    # word ("producer" finds 'produc'); stemming the prefix itself would turn "table" into 'tabl':*,
    # which finds "tabla".
    # `weights` overrides the token's own restriction (the score asks "did it hit the title (A)?").
    # A phrase matches its words anywhere in the row ("wedding band" finds a band that plays
    # weddings); `phrase: true` asks for the words in order instead (only multi-word alternatives),
    # which the score rewards (#phrase_bonus).
    def tsquery(token, weights = token.weights, phrase: false)
      @tsqueries ||= {}
      @tsqueries[[token, weights, phrase]] ||= begin
        restrict = weights.present? ? ":#{weights}" : ""
        stemmed = []
        prefixes = []
        likes = []
        [[token.words, false], [token.prefixes, true]].each do |list, prefix|
          list.each do |alternative|
            words = alternative.split(/[\s\-']+/).reject(&:empty?)
            # Single letters ("a and r", "rock 'n' roll") would reduce to a stray lexeme: substring instead.
            unless alternative.match?(TS_WORDS) && words.all? { _1.length > 1 }
              likes << alternative
              next
            end
            next if phrase && (prefix || words.one?)
            lexemes = words.map { "'#{_1}'#{restrict}" }
            stemmed << (phrase ? lexemes.join(" <-> ") : "(#{lexemes.join(' & ')})")
            prefixes << "'#{words.join(' ')}':*#{weights}" if prefix && words.one?
          end
        end
        parts = []
        parts << "to_tsquery('#{Document::CONFIG}', #{quote(stemmed.uniq.join(' | '))})" if stemmed.any?
        parts << "to_tsquery('simple', #{quote(prefixes.uniq.join(' | '))})" if prefixes.any?
        [parts.any? ? "(#{parts.join(' || ')})" : nil, likes.uniq.map { quote("%#{ActiveRecord::Base.sanitize_sql_like(_1)}%") }]
      end
    end

    private

    # Words a tsquery operand can carry as is: letters (any script: the parser keeps Devanagari
    # words whole) and digits, with spaces, hyphens and apostrophes between words.
    TS_WORDS = /\A[\p{L}\p{M}\p{N}]+(?:[\s\-']+[\p{L}\p{M}\p{N}]+)*\z/

    def document_condition(token, document)
      vector, text = token.location? ? [document.location_vector, document.location_text] : [document.vector, document.text]
      tsquery_sql, likes = tsquery(token)
      parts = []
      parts << "#{vector} @@ #{tsquery_sql}" if tsquery_sql
      parts << "#{text} LIKE ANY (ARRAY[#{likes.join(', ')}])" if likes.any?
      parts << "#{document.text} %> #{quote(token.fuzzy)}" if token.fuzzy
      parts.empty? ? "FALSE" : "(#{parts.join(' OR ')})"
    end

    # `matched`: every row already matches every token (mode :all), so a token's own condition need
    # not be evaluated again for the lowest tier.
    def document_score(document, boost, matched)
      # Trigram similarity to the title is costly per row, and only tells apart rows whose title
      # matched: it is added in the first word's title (A) tier only.
      similarity = "20 * word_similarity(#{quote(text)}, COALESCE(#{document.title}, ''))"
      titled = tokens.find { !_1.location? }
      parts = tokens.map do |token|
        condition = matched ? "TRUE" : document_condition(token, document)
        next "(CASE WHEN #{condition} THEN 1050 ELSE 0 END)" if token.location?
        tiers = { "A" => 1100, "B" => 1060 }.filter_map do |weight, points|
          tiered, = tsquery(token, weight)
          bonus = weight == "A" && token.equal?(titled) ? " + #{similarity}" : ""
          "WHEN #{document.vector} @@ #{tiered} THEN #{points}#{bonus}" if tiered
        end
        fuzzy = token.fuzzy ? " + (CASE WHEN #{document.text} %> #{quote(token.fuzzy)} THEN (20 * word_similarity(#{quote(token.fuzzy)}, #{document.text})) ELSE 0 END)" : ""
        "(CASE #{[*tiers, "WHEN #{condition} THEN 1030"].join(' ')} ELSE 0 END)#{fuzzy}#{as_typed(token, document)}#{phrase_bonus(token, document)}"
      end
      parts << "(CASE WHEN #{boost.condition(document)} THEN 500 ELSE 0 END)" if boost && !boost.blank?
      parts.join(" + ")
    end

    # 100 more when a typed phrase ("wedding band") is there as a phrase, not only as scattered words,
    # so exact phrases lead their tier and the next one down.
    def phrase_bonus(token, document)
      return "" unless token.text.include?(" ")
      phrase, = tsquery(token, phrase: true)
      phrase ? " + (CASE WHEN #{document.vector} @@ #{phrase} THEN 100 ELSE 0 END)" : ""
    end

    # 10 more when the row has the word as typed, not only a synonym or a broader term, so within a
    # tier "harmonium" puts harmonium players ahead of the keyboardists it also searches.
    def as_typed(token, document)
      # A typed phrase gets #phrase_bonus instead.
      return "" if token.alternatives.size < 2 || !token.alternatives.include?(token.text) || token.text.include?(" ")
      typed, = tsquery(token.with(words: [token.text], prefixes: []))
      typed ? " + (CASE WHEN #{document.vector} @@ #{typed} THEN 10 ELSE 0 END)" : ""
    end

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

    # An unknown word matches as a word prefix ("drumm" finds "Drummer"); a short one
    # (Settings.prefix_min_length) only as a whole word, so "dhol" never matches every "dholak"
    # and "ne" does not match every "new".
    def plain(word)
      return Token.new(text: word, words: [word], prefixes: [], known: false) if word.length < Settings.prefix_min_length
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

    def quote(value) = ActiveRecord::Base.lease_connection.quote(value)
  end
end
