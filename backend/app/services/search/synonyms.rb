module Search
  # The search vocabulary in config/search_synonyms.yml, loaded once per process.
  #
  #   Synonyms.expand("singer")  # => ["singer", "vocalist", "playback singer", ...] (the phrase first)
  #   Synonyms.city("bombay")    # => ["mumbai", "bombay", "मुंबई"]
  #   Synonyms.entries           # => [#<Entry kind="role" label="Singer" terms=[...]>, ...] (type-ahead)
  module Synonyms
    PATH = Rails.root.join("config/search_synonyms.yml")
    # Sections of two-way groups, and the kind each one is in the type-ahead.
    KINDS = { "roles" => "role", "acts" => "act_type", "instruments" => "instrument", "genres" => "genre", "events" => "event" }.freeze

    # One synonym group (or city) as the type-ahead offers it: `label` is the group's first entry as
    # written in the file, `terms` every normalised spelling.
    Entry = Data.define(:kind, :label, :terms)

    module_function

    # Every alternative for a known phrase (its two-way group plus any one-way expansions),
    # or nil when the phrase is not in the vocabulary.
    def expand(phrase)
      phrase = normalize(phrase)
      group = data[:groups][phrase]
      broader = data[:broader][phrase]
      return nil unless group || broader
      [phrase, *group, *broader].uniq
    end

    # The one term a two-way group is known by (its first entry), or nil when the phrase is in
    # no group. Two phrases with the same canonical term are synonyms.
    def canonical(phrase) = data[:groups][normalize(phrase)]&.first

    # The city group for a place name or alias, or nil.
    def city(phrase) = data[:cities][normalize(phrase)]

    def stopword?(word) = data[:stopwords].include?(word)

    # Every term the vocabulary knows (for spelling suggestions).
    def terms = data[:terms]

    # Groups and cities with their display labels, in file order (for the type-ahead).
    def entries = data[:entries]

    # Same folding as Search::Query.normalize for the parts that matter here (NFKC, case, spaces), so
    # a Devanagari spelling typed with a precomposed nukta finds the file's entry and vice versa.
    def normalize(text) = text.to_s.unicode_normalize(:nfkc).downcase.squish

    def data
      @data ||= build(YAML.safe_load_file(PATH))
    end

    def build(raw)
      groups = {}
      entries = []
      KINDS.each do |section, kind|
        Array(raw[section]).each do |group|
          members = group.map { normalize(_1) }.uniq
          members.each { |term| groups[term] = ((groups[term] || []) + members).uniq }
          entries << Entry.new(kind:, label: group.first.to_s.strip, terms: members.freeze)
        end
      end
      broader = Array(raw["broader"]).to_h { |key, values| [normalize(key), values.map { normalize(_1) }] }
      cities = {}
      Array(raw["cities"]).each do |group|
        members = group.map { normalize(_1) }
        members.each { cities[_1] = members }
        entries << Entry.new(kind: "city", label: group.first.to_s.strip, terms: members.freeze)
      end
      terms = (groups.keys + broader.keys + broader.values.flatten + cities.keys).uniq.freeze
      { groups: groups.freeze, broader: broader.freeze, cities: cities.freeze, entries: entries.freeze,
        stopwords: Array(raw["stopwords"]).map { normalize(_1) }.to_set.freeze, terms: }.freeze
    end
  end
end
