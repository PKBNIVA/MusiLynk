require "date"

# Turns a handful of resolved links into a draft profile, two passes:
# - deterministic: taxonomy role terms, instrument/genre keywords, an explicit city list,
#   "since 20xx"/"xx years" patterns and credit phrases, matched against the fetched titles and
#   descriptions. Every value carries the source_url it came from.
# - AI (profile_from_links, Haiku): only when AiAssist is enabled, the launch-mode limit for this
#   account/IP isn't used up, and this month's profile-import budget isn't exhausted. Falls back
#   to the deterministic draft (aiUsed: false) otherwise — never an error.
module LinkImport
  class ProfileDraft
    MAX_LINKS = 8
    AI_INPUT_CHAR_CAP = 6_000
    CREDIT_PATTERN = /\b(played with|recorded for|toured with|worked with)\s+([^.\n,;]{1,80})/i
    YEARS_SINCE_PATTERN = /\bsince\s+(19|20)(\d{2})\b/i
    YEARS_COUNT_PATTERN = /\b(\d{1,2})\+?\s*years?\b/i

    Result = Struct.new(:sources, :draft, :ai_used, :provenance, keyword_init: true) do
      def as_json = { sources:, draft:, aiUsed: ai_used, provenance: }
    end

    # `identity` is {user:} for a signed-in caller or {anonymous_ip:} for the public sign-up path
    # — whichever the launch-mode usage cap should be checked against. `resolver:` is only ever
    # overridden by tests (anything responding to `.call(url, own_hosts:)`).
    def self.build(urls, own_hosts: [], identity: {}, resolver: Resolver, ai: AiAssist.new)
      urls = Array(urls).select { _1.is_a?(String) }.first(MAX_LINKS)
      sources = urls.filter_map { |url| resolve_source(url, own_hosts, resolver) }
      flat = flatten(sources)

      deterministic_draft, provenance = extract_deterministic(flat)
      ai_draft = attempt_ai(flat, deterministic_draft, identity, ai)

      if ai_draft
        draft = deterministic_draft.slice(:city, :yearsExperience).merge(ai_draft)
        provenance = provenance.merge(ai_provenance(ai_draft, flat))
        Result.new(sources:, draft:, ai_used: true, provenance:)
      else
        Result.new(sources:, draft: deterministic_draft, ai_used: false, provenance:)
      end
    end

    def self.resolve_source(url, own_hosts, resolver)
      resolver.call(url, own_hosts:)
    rescue LinkPreview::InvalidUrl, SafeFetch::Blocked
      nil
    end

    # Every source plus, one level down, a link-in-bio page's expanded links — each carries the
    # url that a matched fact should be attributed to.
    def self.flatten(sources)
      sources.flat_map { |source| [source] + Array(source[:links]) }
    end

    def self.extract_deterministic(flat)
      roles = {}
      instruments = {}
      genres = {}
      cities = {}
      years = nil
      credits = []
      items = []

      flat.each do |source|
        url = source[:url]
        text = corpus_for(source)
        items << item_for(source) if url

        match_terms(Search::Taxonomy.talent_roles.map { |_key, role| [role[:label], role[:terms]] }, text).each do |label|
          roles[label] ||= url
        end
        match_list(instrument_terms, text).each { |value| instruments[value] ||= url }
        match_list(genre_terms, text).each { |value| genres[value] ||= url }
        Array(source.dig(:artist, :genres)).each { |value| genres[value] ||= url if value.present? }
        match_list(city_terms, text).each { |value| cities[value] ||= url }
        years ||= extract_years(text)

        text.scan(CREDIT_PATTERN) do |_phrase, tail|
          words = tail.to_s.strip.split(/\s+/).first(6)
          next if words.length < 2
          credits << { text: words.join(" "), source_url: url }
        end
      end

      draft = {
        headline: nil, bio: nil,
        roles: roles.keys, genres: genres.keys.uniq, instruments: instruments.keys,
        city: cities.keys.first, yearsExperience: years,
        credits: credits.uniq { _1[:text].downcase }.first(10),
        items: items.first(MAX_LINKS)
      }
      provenance = {}
      roles.each { |label, url| provenance["roles.#{label}"] = url }
      instruments.each { |value, url| provenance["instruments.#{value}"] = url }
      genres.each { |value, url| provenance["genres.#{value}"] = url }
      provenance["city"] = cities.values.first if cities.any?
      [draft, provenance]
    end

    def self.corpus_for(source)
      [source[:title], source[:author], source[:description], source.dig(:channel, :description), source.dig(:artist, :name)].compact.join(" ")
    end

    def self.item_for(source)
      { url: source[:url], title: LinkPreview.clean_text(source[:title], 80), caption: LinkPreview.clean_text(source[:description] || source[:author], 160) }
    end

    def self.match_terms(label_term_pairs, text)
      normalized = text.downcase
      label_term_pairs.filter_map { |label, terms| label if terms.any? { normalized.include?(_1) } }
    end

    def self.match_list(values, text)
      normalized = text.downcase
      values.select { |value| normalized.include?(value.downcase) }
    end

    def self.instrument_terms = CatalogController::INSTRUMENTS
    def self.genre_terms = (Search::Taxonomy.genres + Search::Taxonomy.autocomplete_genres).uniq
    def self.city_terms = Search::Taxonomy.autocomplete_cities

    def self.extract_years(text)
      if (m = text.match(YEARS_SINCE_PATTERN))
        year = "#{m[1]}#{m[2]}".to_i
        result = Date.today.year - year
        return result if result.between?(0, 80)
      end
      if (m = text.match(YEARS_COUNT_PATTERN))
        value = m[1].to_i
        return value if value.between?(0, 80)
      end
      nil
    end

    # --- AI pass ---------------------------------------------------------------------------------

    def self.attempt_ai(flat, deterministic_draft, identity, ai)
      return nil unless AiAssist.enabled?
      return nil unless Budget.available?

      user = identity[:user]
      if user
        return nil unless Budget.remaining_for(user) > 0
      else
        return nil unless Budget.anonymous_available?(identity[:anonymous_ip])
      end

      context = ai_context(flat, deterministic_draft)
      response = ai.suggest(task: "profile_from_links", context:)
      parsed = JSON.parse(response[:suggestion])
      valid_urls = flat.map { _1[:url] }.compact
      cleaned = validate_ai_output(parsed, valid_urls)
      return nil unless cleaned

      cost_inr = AiPricing.estimate_cost_inr(input_tokens: response[:inputTokens], output_tokens: response[:outputTokens], cached_input_tokens: response[:cachedInputTokens])
      user ? Budget.record_spend!(user, cost_inr:) : Budget.record_anonymous!(identity[:anonymous_ip])
      cleaned
    rescue AiAssist::Error, JSON::ParserError, StandardError => e
      Rails.logger.warn({ event: "profile_from_links_ai_failed", error: e.class.name }.to_json)
      nil
    end

    def self.ai_context(flat, deterministic_draft)
      sources_text = flat.filter_map do |source|
        next unless source[:url]
        lines = ["URL: #{source[:url]}", "Title: #{source[:title]}", "Description: #{source[:description] || source[:author]}"]
        lines << "Genres: #{Array(source.dig(:artist, :genres)).join(', ')}" if source.dig(:artist, :genres).present?
        lines.join("\n")
      end.join("\n---\n")
      credits_text = deterministic_draft[:credits].map { "#{_1[:text]} (#{_1[:source_url]})" }.join("\n")
      { sources: (sources_text + "\n" + credits_text).first(AI_INPUT_CHAR_CAP) }
    end

    def self.validate_ai_output(parsed, valid_urls)
      return nil unless parsed.is_a?(Hash)
      taxonomy_labels = Search::Taxonomy.talent_roles.map { |_key, role| role[:label] }

      {
        headline: LinkPreview.clean_text(parsed["headline"], 80),
        bio: LinkPreview.clean_text(parsed["bio"], 600),
        roles: Array(parsed["roles"]).map(&:to_s).select { taxonomy_labels.include?(_1) }.uniq,
        genres: Array(parsed["genres"]).map(&:to_s).first(15),
        instruments: Array(parsed["instruments"]).map(&:to_s).first(15),
        credits: Array(parsed["credits"]).filter_map do |c|
          next unless c.is_a?(Hash)
          url = c["source_url"].to_s
          next unless valid_urls.include?(url)
          { text: LinkPreview.clean_text(c["text"], 200), source_url: url }
        end.first(10),
        items: Array(parsed["items"]).filter_map do |i|
          next unless i.is_a?(Hash)
          url = i["url"].to_s
          next unless valid_urls.include?(url)
          { url:, title: LinkPreview.clean_text(i["title"], 80), caption: LinkPreview.clean_text(i["caption"], 160) }
        end.first(MAX_LINKS)
      }
    end

    def self.ai_provenance(ai_draft, flat)
      out = {}
      out["headline"] = flat.first&.dig(:url) if ai_draft[:headline].present?
      out["bio"] = flat.first&.dig(:url) if ai_draft[:bio].present?
      ai_draft[:credits].each { |c| out["credits.#{c[:text]}"] = c[:source_url] }
      out
    end
  end
end
