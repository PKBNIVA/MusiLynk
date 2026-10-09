# The one SQL statement behind UrgentMatcher#ranked_candidates: candidate selection, the
# role/instrument vocabulary match and the scoring all happen in the database, and only the top
# `candidate_limit` rows come back.
#
# Why SQL: the Ruby scorer it replaced walked every discoverable musician in the city (2,769 for
# Mumbai, 43,702 with no city on the scout seed) and re-tokenised every role name on every
# comparison: 176 µs a candidate, 1.2 s for Mumbai and 11.3 s city-less. Here the database
# pre-filters on the trigram-indexed role, instrument and headline columns with the vocabulary's
# spellings of the wanted role, applies the same whole-word token rule as UrgentMatcher.same_role?
# to the rows that survive, and orders by points.
#
# The token rule, exactly as UrgentMatcher.role_tokens does it in Ruby, for each role, each
# instrument and the headline: lower-case and split on anything non-alphanumeric; a whole phrase
# the vocabulary (Search::Synonyms, config/search_synonyms.yml) knows is its canonical term, else
# the phrase without filler words ("player", "artist", ...) if that is known, else each word on its
# own. A role or instrument matches when either side's tokens are a subset of the other's; the
# headline matches when it contains every wanted token. A blocking availability window
# (unavailable, booked, hold) that overlaps the request removes the person before scoring.
#
# Ties on points are broken by most recent sign-in, then id, so the order is stable.
class UrgentMatcher::Query
  BLOCKING_STATUSES = %w[unavailable booked hold].freeze
  SIGNALS = %i[role instrument city verified recent_activity available].freeze

  def initialize(request)
    @request = request
    @role = request.role_name.to_s.strip.downcase
    @instrument = request.instrument.to_s.strip.downcase
    @wanted = UrgentMatcher.role_tokens(@role).to_a.sort
    @wanted_instrument = @instrument.present? ? UrgentMatcher.role_tokens(@instrument).to_a.sort : []
  end

  # The request names neither a role nor an instrument, so everyone in the city is a candidate.
  def match_everyone? = @role.blank? && @instrument.blank?

  # Whether a row from #top or #rows_for counts as a match for this request.
  def accept?(row) = match_everyone? || row["role_match"] || row["instrument_match"]

  # The top `limit` discoverable musicians for the request, best first: one hash per person with
  # "id", the boolean signals, "last_seen_at" and "points". Only people who match the role or the
  # instrument (or everyone, when the request names neither) and whose availability does not
  # block the time.
  def top(limit)
    return [] unless match_everyone? || @wanted.any? || @wanted_instrument.any?

    where = ["u.role = 'jobseeker'", "u.status = 'active'", "u.profile_complete = TRUE"]
    where << "u.id <> #{quote(@request.requester_id)}" if @request.requester_id.present?
    where << "p.location ILIKE #{quote(city_pattern)}" if city.present?
    run(where:, prefilter: match_everyone? ? nil : prefilter_sql, require_match: !match_everyone?, limit:)
  end

  # The same signals for exactly these people, whatever their account type, city or match (the
  # admin's single-person "Notify"). Someone blocked by availability has no row; use #accept? to
  # tell a non-match from a match.
  def rows_for(user_ids)
    return [] if user_ids.blank?
    run(where: ["u.id IN (#{user_ids.map { quote(_1) }.join(', ')})"], prefilter: nil, require_match: false, limit: nil)
  end

  private

  def city = @request.city.to_s.strip
  def city_pattern = "%#{ActiveRecord::Base.sanitize_sql_like(city)}%"
  def start_at = @request.start_at
  def window_end = @request.end_at || start_at + UrgentConfig.default_duration
  def connection = ActiveRecord::Base.connection
  def quote(value) = connection.quote(value)

  def run(where:, prefilter:, require_match:, limit:)
    connection.select_all(sql(where:, prefilter:, require_match:, limit:), "UrgentMatcher::Query").to_a
  end

  # A PostgreSQL text[] literal.
  def text_array(values)
    values.empty? ? "'{}'::text[]" : "ARRAY[#{values.map { quote(_1) }.join(', ')}]::text[]"
  end

  # The cheap, index-assisted superset of the exact match: a role, instrument or headline can only
  # produce one of the wanted tokens if its text contains one of that token's vocabulary spellings,
  # so it must contain one of the spellings' words. Each word is one trigram ILIKE on the three
  # indexed columns; a word that is a substring of another drops the longer one.
  def prefilter_sql
    words = (@wanted + @wanted_instrument).uniq.flat_map { spellings_of(_1) }.flat_map(&:split).uniq - UrgentMatcher::FILLER_WORDS
    words = words.reject { |word| words.any? { |other| other != word && word.include?(other) } }
    patterns = words.map { "%#{ActiveRecord::Base.sanitize_sql_like(_1)}%" }
    clauses = %w[p.roles::text p.instruments::text p.headline].product(patterns).map { |column, pattern| "#{column} ILIKE #{quote(pattern)}" }
    "(#{clauses.join(' OR ')})"
  end

  # Every normalised spelling that resolves to `token` (its two-way synonym group), or the token
  # itself when the vocabulary does not know it.
  def spellings_of(token)
    group = Search::Synonyms.group(token).map { UrgentMatcher.normalize_phrase(_1) }.reject(&:empty?)
    (group + [token]).uniq
  end

  def blocked_sql
    "EXISTS (SELECT 1 FROM availability_windows w WHERE w.user_id = u.id AND w.status IN (#{BLOCKING_STATUSES.map { quote(_1) }.join(', ')})" \
      " AND w.start_at < #{quote(window_end)} AND w.end_at > #{quote(start_at)})"
  end

  def available_sql
    return "FALSE" unless start_at
    "EXISTS (SELECT 1 FROM availability_windows w WHERE w.user_id = pe.id AND w.status = 'available'" \
      " AND w.start_at <= #{quote(start_at)} AND w.end_at >= #{quote(window_end)})"
  end

  def city_match_sql = city.present? ? "COALESCE(pe.location ILIKE #{quote(city_pattern)}, FALSE)" : "FALSE"

  def points_sql
    terms = { role: "role_match", instrument: "instrument_match", city: "city_match", verified: "verified",
      recent_activity: "active_recently", available: "available" }
    terms.map { |signal, column| "#{column}::int * #{UrgentConfig.weight(signal).to_i}" }.join(" + ")
  end

  def sql(where:, prefilter:, require_match:, limit:)
    vocab = UrgentMatcher.vocabulary
    wanted = text_array(@wanted)
    wanted_instrument = text_array(@wanted_instrument)
    <<~SQL
      WITH vocab AS MATERIALIZED (
        SELECT * FROM unnest(#{text_array(vocab.keys)}, #{text_array(vocab.values)}) AS v(spelling, canonical)
      ),
      people AS MATERIALIZED (
        SELECT u.id, p.roles, p.instruments, p.headline, p.location, p.verified
        FROM users u
        LEFT JOIN profiles p ON p.user_id = u.id
        WHERE #{where.join("\n          AND ")}
          #{"AND #{prefilter}" if prefilter}
          #{"AND NOT #{blocked_sql}" if start_at}
      ),
      terms AS (
        SELECT pe.id, t.kind, t.ord, trim(regexp_replace(lower(t.raw), '[^[:alnum:]]+', ' ', 'g')) AS phrase
        FROM people pe
        CROSS JOIN LATERAL (
          SELECT 'role' AS kind, r.ord, r.raw
          FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(pe.roles) = 'array' THEN pe.roles ELSE '[]'::jsonb END) WITH ORDINALITY AS r(raw, ord)
          UNION ALL
          SELECT 'instrument', i.ord, i.raw
          FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(pe.instruments) = 'array' THEN pe.instruments ELSE '[]'::jsonb END) WITH ORDINALITY AS i(raw, ord)
          UNION ALL
          SELECT 'headline', 0::bigint, pe.headline WHERE pe.headline IS NOT NULL
        ) AS t
      ),
      stripped AS (
        SELECT id, kind, ord, phrase,
          trim(regexp_replace(regexp_replace(phrase, #{quote(filler_regex)}, ' ', 'g'), ' {2,}', ' ', 'g')) AS bare
        FROM terms
      ),
      looked_up AS (
        SELECT s.id, s.kind, s.ord, s.bare, v1.canonical AS whole_canon, v2.canonical AS bare_canon
        FROM stripped s
        LEFT JOIN vocab v1 ON v1.spelling = s.phrase
        LEFT JOIN vocab v2 ON v2.spelling = s.bare
      ),
      tokens AS (
        SELECT id, kind, ord, ARRAY[COALESCE(whole_canon, bare_canon)] AS tokens
        FROM looked_up
        WHERE whole_canon IS NOT NULL OR bare_canon IS NOT NULL
        UNION ALL
        SELECT l.id, l.kind, l.ord, array_agg(COALESCE(v.canonical, w.word))
        FROM looked_up l
        CROSS JOIN LATERAL unnest(string_to_array(l.bare, ' ')) AS w(word)
        LEFT JOIN vocab v ON v.spelling = w.word
        WHERE l.whole_canon IS NULL AND l.bare_canon IS NULL AND l.bare <> ''
        GROUP BY l.id, l.kind, l.ord
      ),
      matched AS (
        SELECT id,
          bool_or(kind <> 'headline' AND (tokens <@ #{wanted} OR #{wanted} <@ tokens)) AS term_match,
          bool_or(kind = 'headline' AND #{wanted} <@ tokens) AS headline_match,
          bool_or(kind = 'instrument' AND (tokens <@ #{wanted_instrument} OR #{wanted_instrument} <@ tokens)) AS instrument_match
        FROM tokens
        GROUP BY id
      ),
      scored AS (
        SELECT pe.id,
          (#{@wanted.any?} AND COALESCE(m.term_match OR m.headline_match, FALSE)) AS role_match,
          (#{@wanted_instrument.any?} AND COALESCE(m.instrument_match, FALSE)) AS instrument_match,
          #{city_match_sql} AS city_match,
          COALESCE(pe.verified, FALSE) AS verified,
          COALESCE(ls.last_seen_at >= #{quote(UrgentConfig.recent_activity_within.ago)}, FALSE) AS active_recently,
          #{available_sql} AS available,
          ls.last_seen_at
        FROM people pe
        LEFT JOIN matched m ON m.id = pe.id
        LEFT JOIN LATERAL (SELECT max(s.last_seen_at) AS last_seen_at FROM sessions s WHERE s.user_id = pe.id) AS ls ON TRUE
      )
      SELECT id, role_match, instrument_match, city_match, verified, active_recently, available, last_seen_at,
        (#{points_sql}) AS points
      FROM scored
      #{"WHERE role_match OR instrument_match" if require_match}
      ORDER BY points DESC, last_seen_at DESC NULLS LAST, id
      #{"LIMIT #{limit.to_i}" if limit}
    SQL
  end

  # Whole-word filler removal, the SQL twin of UrgentMatcher::FILLER_WORDS.
  def filler_regex = "\\m(#{UrgentMatcher::FILLER_WORDS.join('|')})\\M"
end
