# Reads a work sample and proposes what it is about. Pluggable: anything that responds to
#
#   classify(item, portfolios: [])  -> PortfolioItemClassifier::Result
#   classify_text(text, extra: {})  -> { "roles" => [...], "genres" => [...], "instruments" => [...], "tags" => [...] }
#
# can be installed with `PortfolioItemClassifier.implementation = ...` (an AI-backed one later).
# The default, Keyword, never calls out: it matches taxonomy terms (roles, instruments, genres and
# a few tag words) and the words the owner's portfolio rules use against the item's text.
#
# Result fields: tags/roles/genres/instruments are values the item does not have yet;
# suggested_portfolio_ids are portfolios the item nearly belongs to, with reasons[portfolio_id].
module PortfolioItemClassifier
  Result = Data.define(:tags, :roles, :genres, :instruments, :suggested_portfolio_ids, :reasons) do
    def facets = { "tags" => tags, "roles" => roles, "genres" => genres, "instruments" => instruments }
    def any_facets? = facets.values.any?(&:any?)
  end

  FACETS = %w[roles genres instruments tags].freeze

  mattr_accessor :implementation

  def self.current = implementation || (@keyword ||= Keyword.new)

  class Keyword
    TAG_TERMS = %w[live studio session cover original remix acoustic unplugged wedding corporate festival concert showreel
      demo jingle soundtrack teaching workshop].freeze

    def classify(item, portfolios: [])
      extra = portfolios.each_with_object(Hash.new { |h, k| h[k] = [] }) do |portfolio, out|
        portfolio.rule_set.vocabulary.each { |dim, values| out[dim] |= values }
      end
      found = classify_text([item.title, item.description, item.credited_as].compact.join(" \n "), extra:)
      own = Portfolio.facets_for(item)
      fresh = FACETS.index_with do |dim|
        have = own.fetch(dim, []).map(&:downcase)
        found.fetch(dim, []).reject { have.include?(_1.downcase) }
      end
      reasons = {}
      portfolios.each do |portfolio|
        next if portfolio.pinned?(item) || portfolio.excluded?(item)
        reason = portfolio.rule_set.near_miss(own, fresh, Portfolio.year_for(item))
        reasons[portfolio.id] = reason if reason
      end
      Result.new(tags: fresh["tags"], roles: fresh["roles"], genres: fresh["genres"], instruments: fresh["instruments"],
        suggested_portfolio_ids: reasons.keys, reasons:)
    end

    def classify_text(text, extra: {})
      text = text.to_s
      return FACETS.index_with { [] } if text.strip.empty?
      vocabulary(extra).transform_values do |terms|
        terms.select { |term| pattern(term).match?(text) }.uniq(&:downcase)
      end
    end

    private

    def vocabulary(extra)
      base = {
        "roles" => CatalogController::ROLE_CATEGORIES.values.flatten,
        "genres" => Search::Taxonomy.genres,
        "instruments" => CatalogController::INSTRUMENTS,
        "tags" => TAG_TERMS
      }
      FACETS.index_with { |dim| (base[dim] + Array(extra[dim])).uniq(&:downcase) }
    end

    PATTERN_CACHE_LIMIT = 5_000

    # Whole-word, case-insensitive. Compiled patterns are cached up to a bound, since owners'
    # rule words add to the taxonomy terms.
    def pattern(term)
      key = term.downcase
      cache = (@patterns ||= {})
      cache[key] || begin
        compiled = /(?<![[:alnum:]])#{Regexp.escape(key)}(?![[:alnum:]])/i
        cache[key] = compiled if cache.size < PATTERN_CACHE_LIMIT
        compiled
      end
    end
  end
end
