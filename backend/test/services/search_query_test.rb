require "test_helper"

class SearchQueryTest < ActiveSupport::TestCase
  def texts(raw) = Search::Query.new(raw).tokens.map(&:text)

  test "normalises case, spacing and punctuation" do
    query = Search::Query.new("   SiNgEr!!   ")
    assert_equal "singer", query.text
    assert_equal ["singer"], query.tokens.map(&:text)
    assert_equal "rock and roll", Search::Query.new("Rock & Roll").text
  end

  test "reads the longest vocabulary phrase first and folds plurals" do
    assert_equal ["guitar player", "bombay"], texts("Guitar players in Bombay")
    assert_equal ["bass guitarist"], texts("bass guitarist")
    assert_equal ["singer"], texts("singers")
    tokens = Search::Query.new("guitar players in Bombay").tokens
    assert_includes tokens.first.alternatives, "guitarist"
    assert tokens.last.location?, "a city is a location token"
    assert_equal %w[mumbai bombay मुंबई], tokens.last.alternatives
  end

  test "drops stop words from multi-word queries but keeps a lone one" do
    assert_equal %w[vocalist wedding], texts("vocalist for a wedding")
    assert_equal ["for"], texts("for")
    assert_empty texts("a 1"), "a stop word next to a dropped fragment is not searched on its own"
  end

  test "unknown words match as prefixes with their singular; short ones as whole words" do
    token = Search::Query.new("drums").tokens.first
    assert_includes token.alternatives, "drummer", "drums is a synonym of drummer"
    token = Search::Query.new("sessions").tokens.first
    assert_equal %w[sessions session], token.prefixes
    assert_not token.known?
    short = Search::Query.new("ne").tokens.first
    assert_equal ["ne"], short.words
    assert_empty short.prefixes
  end

  test "english plural folding" do
    { "singers" => "singer", "classes" => "class", "melodies" => "melody", "bass" => "bass", "chorus" => "chorus", "keys" => "key", "bus" => "bus" }.each do |word, singular|
      assert_equal singular, Search::Query.singular(word), word
    end
  end

  test "Devanagari words are lexemes; emoji are matched by substring" do
    token = Search::Query.new("गायक").tokens.first
    assert_includes token.alternatives, "vocalist", "Hindi for singer is in the singer group"
    emoji = Search::Query.new("🥁")
    assert_equal ["🥁"], emoji.tokens.map(&:text)
    assert_includes emoji.condition(Search::Targets::JOBS), "LIKE ANY"
    assert_not_includes Search::Query.new("गायक").condition(Search::Targets::JOBS), "LIKE ANY", "the parser keeps Devanagari words whole"
  end

  test "code-like and symbol-only input is inert or exact" do
    ["%", "_", "\\", "' OR '1'='1", "%' OR 1=1 --"].each do |raw|
      query = Search::Query.new(raw)
      assert query.inert?, "#{raw.inspect} leaves nothing to search"
      assert_not query.natural?, "#{raw.inspect} is code-like"
    end
    assert_not Search::Query.new("'; DROP TABLE jobs; --").natural?
    assert Search::Query.new("guitarist mumbai").natural?
    assert_not Search::Query.new("").inert?, "an empty query is blank, not inert"
    assert Search::Query.new("").blank?
  end

  test "interpretedAs lists the query and then every alternative" do
    assert_equal ["bassoon"], Search::Query.new("bassoon").interpreted_as
    interpreted = Search::Query.new("vocalist").interpreted_as
    assert_equal "vocalist", interpreted.first
    assert_includes interpreted, "playback singer"
    assert_operator interpreted.size, :<=, Search::Query::MAX_INTERPRETED
    assert_equal [], Search::Query.new("").interpreted_as
  end

  test "queries are cut to the maximum length and capped in tokens" do
    assert_equal Search::Query::MAX_LENGTH, Search::Query.new("x" * 500).text.length
    assert_equal Search::Query::MAX_TOKENS, Search::Query.new((1..20).map { "word#{_1}" }.join(" ")).tokens.size
  end

  test "conditions are AND across tokens and OR within one; partial is OR over the words" do
    query = Search::Query.new("guitarist mumbai")
    all = query.condition(Search::Targets::JOBS)
    assert_includes all, " AND "
    assert_includes all, "jobs.search_vector @@", "matching uses the indexed document, not per-column regexes"
    assert_includes all, "''guitar'' <-> ''player''", "a vocabulary phrase is matched as consecutive words"
    assert_includes all, "''mumbai'':D", "a city matches the location weight only"
    partial = query.condition(Search::Targets::JOBS, mode: :partial)
    assert_not_includes partial, " AND ", "partial mode ignores the city and needs one of the other words"
    assert_includes query.score(Search::Targets::JOBS), "word_similarity"
  end

  test "replace swaps one token for the parse of another phrase" do
    query = Search::Query.new("guitarst mumbai")
    fixed = query.replace(query.tokens.first, "guitarist")
    assert_equal "guitarist mumbai", fixed.text
    assert fixed.tokens.first.known?
    assert fixed.tokens.last.location?
  end

  test "symbols become substring matches and hyphenated words become phrases" do
    sql = Search::Query.new("a&r hip-hop").condition(Search::Targets::TALENT)
    assert_includes sql, "profiles.search_text LIKE ANY (ARRAY['%a&r%'"
    assert_includes sql, "''hip'' <-> ''hop''"
    assert_not_includes sql, "''a''", "a lone letter never becomes a lexeme of its own"
  end

  test "dhol and dholak are different words, and short unknown words match whole words only" do
    dhol = Search::Query.new("dhol").tokens.first
    assert_includes dhol.alternatives, "dhol player"
    assert_not_includes dhol.alternatives, "dholak"
    assert_not_includes Search::Query.new("dholak").tokens.first.alternatives, "dhol"
    short = Search::Query.new("sur").tokens.first
    assert_equal ["sur"], short.words
    assert_empty short.prefixes
    query = Search::Query.new("drumm")
    sql, = query.tsquery(query.tokens.first)
    assert_includes sql, "to_tsquery('simple', '''drumm'':*')", "a prefix is matched unstemmed"
  end

  test "Hindi, Hinglish and Devanagari spellings share a group" do
    { "gayak" => "singer", "गायक" => "vocalist", "shaadi" => "wedding", "tablist" => "tabla player", "keys" => "piano",
      "disc jockey" => "dj", "mehndi" => "mehendi", "barat" => "baraat", "ढोल" => "dhol player", "geetkar" => "lyricist" }.each do |typed, expected|
      assert_includes Search::Query.new(typed).tokens.first.alternatives, expected, typed
    end
    assert_includes Search::Query.new("wedding").interpreted_as, "sangeet", "wedding also searches its ceremonies (one way)"
    assert_not_includes Search::Query.new("sangeet").tokens.first.alternatives, "wedding"
  end

  test "synonyms file loads groups, one-way expansions, cities and stop words" do
    assert_includes Search::Synonyms.expand("fiddle"), "violinist"
    assert_includes Search::Synonyms.expand("percussionist"), "tabla player"
    assert_not_includes Search::Synonyms.expand("tabla player"), "drummer", "broader terms are one-way"
    assert_nil Search::Synonyms.expand("bassoon")
    assert_equal %w[kochi cochin], Search::Synonyms.city("Cochin")
    assert Search::Synonyms.stopword?("on"), "YAML must not read on as true"
    assert Search::Synonyms.terms.all?(String)
  end

  test "spelling picks the fewest edits and prefers longer words on a tie" do
    Search::Spelling.reset!
    assert_equal 1, Search::Spelling.edit_distance("guitarst", "guitarist")
    assert_equal 1, Search::Spelling.edit_distance("voilinist", "violinist"), "a swap is one edit"
    assert_equal 0, Search::Spelling.edit_distance("", "")
    assert_equal "vocalist", Search::Spelling.suggest("vocalst")
    assert_equal "guitarist", Search::Spelling.suggest("guitarst")
    assert_equal "dholak player", Search::Synonyms.canonical(Search::Spelling.suggest("dholk")), "a missing letter: a dholak spelling, not dhol"
    assert_includes Search::Synonyms.expand("tabala"), "tabla", "a common spelling is vocabulary, not a typo"
    assert_nil Search::Spelling.suggest("zzqqxx")
    assert_equal "vocalist", Search::Spelling.suggest("vocalst"), "cached"
  end

  test "taxonomy maps legacy function names and role tiles" do
    assert_equal "Music Production", Search::Taxonomy.canonical_function("production")
    assert_equal "Performance", Search::Taxonomy.canonical_function("Performance")
    assert_equal "Something New", Search::Taxonomy.canonical_function("Something New")
    assert_equal "", Search::Taxonomy.canonical_function(" ")
    assert_equal ["Music Production", "Production"], Search::Taxonomy.function_spellings("Production")
    assert_equal ["Tour & Production Management", "Live & Touring", "Touring"], Search::Taxonomy.function_spellings("Tour & Production Management")
    assert_includes Search::Taxonomy.talent_role_terms("PERFORMER"), "vocalist"
    assert_nil Search::Taxonomy.talent_role_terms("nobody")
    assert_equal %w[performer engineer A&R manager live music-tech], Search::Taxonomy.as_json[:talentRoles].pluck(:key)
  end

  test "the posting form offers exactly the taxonomy's functions" do
    source = Rails.root.join("../src/app/pages/PostJob.tsx").read
    list = source[/const functions = \[(.*?)\];/m, 1]
    assert list, "PostJob.tsx keeps its function list in `const functions = [...]` (update this check if it moves)"
    assert_equal Search::Taxonomy.function_areas, list.scan(/'([^']+)'/).flatten
  end

  test "any_of ORs single-word roles into one token and keeps multi-word roles as phrases" do
    query = Search::Query.any_of(["Drummer", "Vocalist"])
    assert_equal 1, query.tokens.size
    assert_includes query.tokens.first.alternatives, "drummer"
    assert_includes query.tokens.first.alternatives, "vocalist"

    phrase = Search::Query.any_of(["Sound engineer", "Drummer"])
    assert_equal 1, phrase.tokens.size
    assert_includes phrase.tokens.first.words, "sound engineer"

    assert_equal "drummer", Search::Query.any_of(["Drummer"]).text
    assert Search::Query.any_of([]).blank?
    assert_not Search::Query.any_of([]).inert?
    assert Search::Query.any_of(["%$;"]).inert?
  end

  test "and narrows one query by another and keeps an inert query inert" do
    typed = Search::Query.new("wedding")
    roles = Search::Query.any_of(%w[Drummer Vocalist])
    both = typed.and(roles)
    assert_equal 2, both.tokens.size
    assert_equal roles.tokens, Search::Query.new("").and(roles).tokens
    assert_equal typed.tokens, typed.and(Search::Query.new("")).tokens
    assert typed.and(Search::Query.new("%$;")).inert?
    assert Search::Query.new("%$;").and(roles).inert?
  end
end
