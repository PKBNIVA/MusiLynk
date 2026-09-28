# The membership rules of a portfolio or resume. Stored as JSON:
#
#   {
#     "everything": true,                            # start from the whole library
#     "any":     { "genres": ["jazz"], "roles": [...] },   # has at least one of these values
#     "all":     { "tags": ["live", "original"] },          # has every one of these values
#     "only":    { "genres": ["jazz", "blues"] },           # elimination: an item that states a
#                                                           # genre must state one of these; items
#                                                           # with no genre stay in
#     "exclude": { "tags": ["cover"] },                     # has none of these values
#     "yearFrom": 2018, "yearTo": 2024,                     # by the item's year
#     "sort": "featured"                                    # see `sorts`
#   }
#
# An item is a member when the year fits, nothing in `exclude` hits, `only` is satisfied and
# either `everything` is set or there is at least one `any`/`all` condition and all of them hold.
# Values compare case-insensitively. `dims` names the facets a rule may use (portfolio items:
# roles, genres, instruments, kinds, tags; career entries: kinds, tags).
class ShowcaseRules
  KEYS = %w[everything any all only exclude yearFrom yearTo sort].freeze
  CONDITIONS = %w[any all only exclude].freeze
  MAX_VALUES = 30
  VALUE_LIMIT = 80
  YEARS = 1900..2100

  attr_reader :raw, :dims, :sorts

  def initialize(raw, dims:, sorts:)
    @raw = raw.is_a?(Hash) ? raw.stringify_keys : raw
    @dims = dims
    @sorts = sorts
  end

  # Human-readable problems with the stored JSON (empty when valid).
  def errors
    return ["must be an object"] unless raw.is_a?(Hash)
    problems = []
    unknown = raw.keys - KEYS
    problems << "has unknown keys: #{unknown.join(', ')}" if unknown.any?
    problems << "everything must be true or false" unless [nil, true, false].include?(raw["everything"])
    CONDITIONS.each { |name| problems.concat(condition_errors(name)) }
    %w[yearFrom yearTo].each do |key|
      value = raw[key]
      problems << "#{key} must be a year from #{YEARS.first} to #{YEARS.last}" unless value.nil? || (value.is_a?(Integer) && YEARS.cover?(value))
    end
    from, to = raw.values_at("yearFrom", "yearTo")
    problems << "yearTo must not be before yearFrom" if from.is_a?(Integer) && to.is_a?(Integer) && to < from
    problems << "sort must be one of: #{sorts.join(', ')}" unless raw["sort"].nil? || sorts.include?(raw["sort"])
    problems
  end

  def sort = raw.is_a?(Hash) && raw["sort"].presence || sorts.first
  def everything? = raw.is_a?(Hash) && raw["everything"] == true

  # `facets`: { "genres" => ["Jazz", ...], ... } for one item. `year`: the item's year or nil.
  def match?(facets, year = nil)
    return false unless raw.is_a?(Hash) && year_fits?(year)
    facets = lowered(facets)
    return false if hits(condition("exclude"), facets).any?
    return false unless only_holds?(facets)
    return true if everything?
    any, all = condition("any"), condition("all")
    return false if any.empty? && all.empty?
    (any.empty? || hits(any, facets).any?) && all.all? { |dim, values| (values - facets.fetch(dim, [])).empty? }
  end

  # Why an item that is not a member nearly is, or nil. `inferred` holds facet values a classifier
  # read from the item's text: when adding them would make it match, that is a near miss (and
  # accepting the tag suggestion would make it join on its own). An item that has some but not all
  # of the `all` values is also a near miss.
  def near_miss(facets, inferred, year = nil)
    return nil if !raw.is_a?(Hash) || match?(facets, year) || !year_fits?(year)
    own = lowered(facets)
    return nil if hits(condition("exclude"), own).any?
    extra = lowered(inferred)
    merged = (own.keys | extra.keys).index_with { (own.fetch(_1, []) | extra.fetch(_1, [])) }
    if match?(merged, year)
      found = hits(condition("any").merge(condition("all")) { |_dim, a, b| a | b }, extra)
      return "Its title or description mentions #{found.first(3).join(', ')}" if found.any?
    end
    all = condition("all")
    have = all.flat_map { |dim, values| values & own.fetch(dim, []) }
    missing = all.flat_map { |dim, values| values - own.fetch(dim, []) }
    return nil unless have.any? && missing.any? && only_holds?(own)
    any = condition("any")
    return nil unless any.empty? || hits(any, own).any?
    "Has #{have.first(3).join(', ')} but not #{missing.first(3).join(', ')}"
  end

  # Every value the rules mention, by dimension (for classifiers that look for them in text).
  def vocabulary
    CONDITIONS.each_with_object(Hash.new { |h, k| h[k] = [] }) do |name, out|
      next unless raw.is_a?(Hash) && raw[name].is_a?(Hash)
      raw[name].each { |dim, values| out[dim.to_s] |= Array(values).grep(String) }
    end
  end

  private

  def condition_errors(name)
    value = raw[name]
    return [] if value.nil?
    return ["#{name} must be an object of lists"] unless value.is_a?(Hash)
    problems = []
    unknown = value.keys.map(&:to_s) - dims
    problems << "#{name} has unknown fields: #{unknown.join(', ')} (use #{dims.join(', ')})" if unknown.any?
    value.each do |dim, values|
      valid = values.is_a?(Array) && values.length <= MAX_VALUES && values.all? { _1.is_a?(String) && _1.strip.length.between?(1, VALUE_LIMIT) }
      problems << "#{name}.#{dim} must be a list of up to #{MAX_VALUES} values of up to #{VALUE_LIMIT} characters" unless valid
    end
    problems
  end

  # { dim => [lowercased values] } for one condition, only for known dimensions.
  def condition(name)
    value = raw[name]
    return {} unless value.is_a?(Hash)
    value.each_with_object({}) do |(dim, values), out|
      next unless dims.include?(dim.to_s) && values.is_a?(Array)
      list = values.grep(String).map { _1.strip.downcase }.reject(&:empty?)
      out[dim.to_s] = list if list.any?
    end
  end

  def lowered(facets)
    facets.to_h.each_with_object({}) do |(dim, values), out|
      out[dim.to_s] = Array(values).grep(String).map { _1.strip.downcase }.reject(&:empty?)
    end
  end

  def hits(condition, facets) = condition.flat_map { |dim, values| values & facets.fetch(dim, []) }

  def only_holds?(facets)
    condition("only").all? do |dim, values|
      stated = facets.fetch(dim, [])
      stated.empty? || (stated & values).any?
    end
  end

  def year_fits?(year)
    from, to = raw.values_at("yearFrom", "yearTo")
    return true if from.nil? && to.nil?
    return false if year.nil?
    (!from.is_a?(Integer) || year >= from) && (!to.is_a?(Integer) || year <= to)
  end
end
