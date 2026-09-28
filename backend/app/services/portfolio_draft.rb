# Proposes a new portfolio "by elimination": start from the whole library, then remove what the
# goal rules out. The goal ("session guitar for jazz and blues gigs") is read by the classifier
# into roles, genres and instruments, which become an `only` rule: an item that states a genre
# must state one of the goal's genres, and items that state none stay in (nothing rules them out).
# Because it is a rule, future items are sorted the same way. Nothing is saved.
class PortfolioDraft
  ELIMINATING = %w[roles genres instruments].freeze

  def initialize(goal:, title:, purpose:, classifier: PortfolioItemClassifier.current)
    @goal = goal.to_s
    @title = title.to_s.strip.first(Portfolio::TEXT_LIMITS[:title])
    @purpose = purpose.to_s.strip.parameterize.first(Portfolio::TEXT_LIMITS[:purpose]).presence
    @classifier = classifier
  end

  def call(library)
    terms = @classifier.classify_text(@goal, extra: library_vocabulary(library)).slice(*ELIMINATING).reject { |_dim, values| values.empty? }
    rules = { "everything" => true, "sort" => "featured" }
    rules["only"] = terms if terms.any?
    set = ShowcaseRules.new(rules, dims: Portfolio::DIMS, sorts: Portfolio::SORTS)
    items = library.map { |item| verdict(item, set, terms) }
    kept = items.count { _1[:included] }
    {
      title: @title.presence || "New portfolio", purpose: @purpose, rules:, pinnedItemIds: [], excludedItemIds: [], terms:,
      items:, summary: { total: items.length, kept:, removed: items.length - kept },
      note: terms.empty? ? "No genre, role or instrument was recognised in the goal, so every work sample is included. Remove what does not fit." : nil
    }
  end

  private

  def verdict(item, set, terms)
    facets = Portfolio.facets_for(item)
    included = set.match?(facets, Portfolio.year_for(item))
    { itemId: item.id, title: item.title, included:, reason: reason_for(facets, terms, included) }
  end

  def reason_for(facets, terms, included)
    return "Kept: nothing in the goal rules it out" if terms.empty?
    lowered = ->(values) { values.map(&:downcase) }
    matched = terms.flat_map { |dim, values| facets.fetch(dim, []).select { lowered.call(values).include?(_1.downcase) } }
    return "Kept: matches #{matched.first(3).join(', ')}" if included && matched.any?
    return "Kept: it does not state a #{terms.keys.map { _1.delete_suffix('s') }.join(' or ')}, so nothing rules it out" if included
    dim, values = terms.find { |d, v| (lowered.call(facets.fetch(d, [])) & lowered.call(v)).empty? && facets.fetch(d, []).any? }
    "Removed: #{dim} #{facets[dim].first(3).join(', ')}, not #{values.first(3).join(', ')}"
  end

  # The owner's own words (from their items) join the taxonomy, so custom genres are recognised.
  def library_vocabulary(library)
    ELIMINATING.index_with { |dim| library.flat_map { Portfolio.facets_for(_1).fetch(dim, []) }.grep(String).uniq }
  end
end
