# Taxonomy-backed autocomplete for GET /api/ai/autocomplete. Works with no AI key configured:
# it matches the query by prefix first, then loosely (substring / small edit distance) against
# the flat value lists in Search::Taxonomy. AiController adds AI-sourced suggestions on top of
# this only when AI is enabled and fewer than 3 matches come back.
module AutocompleteTaxonomy
  FIELDS = %w[skills genres instruments roles cities].freeze
  MAX_QUERY_LENGTH = 60
  MAX_DISTANCE = 2

  module_function

  def match(field, query)
    query = query.to_s.strip[0, MAX_QUERY_LENGTH]
    values = values_for(field)
    return [] if query.blank?

    downcased = query.downcase
    prefix = values.select { _1.downcase.start_with?(downcased) }
    remaining = values - prefix
    substring = remaining.select { _1.downcase.include?(downcased) }
    remaining -= substring
    fuzzy = remaining.select { levenshtein(_1.downcase, downcased) <= MAX_DISTANCE }

    (prefix + substring + fuzzy).first(10).map { { value: _1, source: "taxonomy" } }
  end

  def values_for(field)
    case field
    when "skills" then Search::Taxonomy.autocomplete_skills
    when "genres" then Search::Taxonomy.autocomplete_genres
    when "cities" then Search::Taxonomy.autocomplete_cities
    when "instruments" then CatalogController::INSTRUMENTS
    when "roles" then Search::Taxonomy.talent_roles.values.map { _1[:label] } + CatalogController::ROLE_CATEGORIES.values.flatten
    else []
    end
  end

  # Classic dynamic-programming edit distance, bounded to short strings by MAX_QUERY_LENGTH,
  # so this never runs against anything large enough to matter for cost.
  def levenshtein(a, b)
    return b.length if a.empty?
    return a.length if b.empty?

    previous = (0..b.length).to_a
    a.each_char.with_index(1) do |ca, i|
      current = [i] + Array.new(b.length)
      b.each_char.with_index(1) do |cb, j|
        cost = ca == cb ? 0 : 1
        current[j] = [previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost].min
      end
      previous = current
    end
    previous[b.length]
  end
end
