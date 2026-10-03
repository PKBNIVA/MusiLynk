module Search
  # Type-ahead for the search box (GET /api/search/suggest?q=): the roles, instruments, genres,
  # events, act types and cities whose name or any spelling starts with what was typed (from the
  # vocabulary in config/search_synonyms.yml and the catalog lists), plus people's and acts' names
  # with a word starting with it. Limits are in config/search.yml (suggest).
  #
  #   Suggest.call("tab", viewer_synthetic: false)
  #   # => [{ kind: "role", label: "Tabla player", query: "Tabla player" }, ...,
  #   #     { kind: "name", label: "Tabassum Ali", detail: "Singer from Pune", url: "/professionals/u_1" }]
  class Suggest
    KIND_ORDER = %w[role instrument genre event act_type city name act].freeze

    def self.call(raw, viewer_synthetic:) = new(raw, viewer_synthetic).call

    def initialize(raw, viewer_synthetic)
      @text = Query.normalize(raw.to_s.first(Settings.suggest.fetch("max_length"))).strip
      @viewer_synthetic = viewer_synthetic
    end

    def call
      return [] if @text.length < Settings.suggest.fetch("min_length") || @text.match?(Query::CODE_LIKE)
      found = terms + names + acts
      found.sort_by { [KIND_ORDER.index(_1[:kind]), _1[:rank]] }.first(Settings.suggest.fetch("max_total")).map { _1.except(:rank) }
    end

    # Every vocabulary entry plus the catalog roles and instruments the vocabulary does not cover.
    def self.entries
      @entries ||= begin
        vocabulary = Synonyms.entries
        known = vocabulary.flat_map(&:terms).to_set
        catalog = CatalogController::ROLE_CATEGORIES.values.flatten.map { Synonyms::Entry.new(kind: "role", label: _1, terms: [Synonyms.normalize(_1)]) } +
          CatalogController::INSTRUMENTS.map { Synonyms::Entry.new(kind: "instrument", label: _1, terms: [Synonyms.normalize(_1)]) }
        (vocabulary + catalog.reject { known.include?(_1.terms.first) }).freeze
      end
    end

    private

    def limit(kind) = Settings.suggest.fetch("per_kind").fetch(kind, 0)

    # Rank 0: the label starts with the text; 1: another spelling does; 2: a later word does.
    def terms
      words = ->(term) { term.split(/[\s\-]+/) }
      ranked = self.class.entries.filter_map do |entry|
        label = Synonyms.normalize(entry.label)
        rank = if label.start_with?(@text) then 0
        elsif entry.terms.any? { _1.start_with?(@text) } then 1
        elsif entry.terms.any? { |term| words.(term).drop(1).any? { _1.start_with?(@text) } } then 2
        end
        [entry, [rank, entry.label.length, entry.label]] if rank
      end
      ranked.group_by { _1.first.kind }.flat_map do |kind, list|
        list.sort_by(&:last).first(limit(kind)).map { |entry, rank| { kind:, label: entry.label, query: entry.label, rank: } }
      end
    end

    # Names with a word starting with the text (served by the trigram index on users.name).
    def names
      return [] if limit("name").zero?
      scope = User.discoverable_talent.joins(:profile)
      scope = SyntheticQa::Demo.publicly_listed(scope) unless @viewer_synthetic
      scope.where("users.name ILIKE :start OR users.name ILIKE :word", **word_start).order(Arel.sql("profiles.verified DESC"), :name, :id).limit(limit("name"))
        .pluck(:id, :name, "profiles.headline").map do |id, name, headline|
          { kind: "name", label: name, detail: headline.presence, url: "/professionals/#{id}", rank: [name_rank(name), 0, name] }.compact
        end
    end

    def acts
      return [] if limit("act").zero?
      scope = Act.where(status: "active")
      scope = SyntheticQa::Demo.publicly_listed_acts(scope) unless @viewer_synthetic
      scope.where("acts.name ILIKE :start OR acts.name ILIKE :word", **word_start).order(verified: :desc, name: :asc, id: :asc).limit(limit("act"))
        .pluck(:id, :name, :act_type, :city).map do |id, name, act_type, city|
          { kind: "act", label: name, detail: [act_type, city].compact_blank.join(" · ").presence, url: "/acts/#{id}", rank: [name_rank(name), 0, name] }.compact
        end
    end

    # LIKE patterns for a name that starts with the text, or has a later word that does.
    def word_start
      like = ActiveRecord::Base.sanitize_sql_like(@text)
      { start: "#{like}%", word: "% #{like}%" }
    end

    def name_rank(name) = Synonyms.normalize(name).start_with?(@text) ? 0 : 2
  end
end
