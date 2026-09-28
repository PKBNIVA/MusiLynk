module Search
  # Job functions and directory role groups from config/search_taxonomy.yml: the single list that
  # posting, filtering, job alerts and the landing-page tiles all use.
  module Taxonomy
    PATH = Rails.root.join("config/search_taxonomy.yml")

    module_function

    def function_areas = data[:function_areas]

    # Old function values mapped to their current name.
    def legacy_function_areas = data[:legacy]

    # The current name for a function value (legacy or current, any case), or the value unchanged.
    def canonical_function(value)
      value = value.to_s.strip
      return value if value.empty?
      data[:lookup][value.downcase] || value
    end

    # Every stored spelling that means `value`: the current name plus its legacy names.
    def function_spellings(value)
      canonical = canonical_function(value)
      [canonical, *data[:legacy].select { |_old, current| current == canonical }.keys].uniq
    end

    # { "performer" => { label:, terms: [...] }, ... }
    def talent_roles = data[:talent_roles]

    # The search terms for a directory role key ("performer", "A&R"; any case), or nil.
    def talent_role_terms(key) = data[:role_lookup][key.to_s.strip.downcase]&.fetch(:terms)

    def as_json
      { functionAreas: function_areas, legacyFunctionAreas: legacy_function_areas,
        talentRoles: talent_roles.map { |key, role| { key:, label: role[:label] } } }
    end

    def data
      @data ||= begin
        raw = YAML.safe_load_file(PATH)
        functions = raw.fetch("function_areas").freeze
        legacy = raw.fetch("legacy_function_areas").freeze
        lookup = functions.to_h { [_1.downcase, _1] }.merge(legacy.to_h { |old, current| [old.downcase, current] })
        roles = raw.fetch("talent_roles").to_h do |key, role|
          [key, { label: role.fetch("label"), terms: role.fetch("terms").map { _1.to_s.downcase }.freeze }.freeze]
        end.freeze
        { function_areas: functions, legacy:, lookup: lookup.freeze, talent_roles: roles,
          role_lookup: roles.transform_keys(&:downcase).freeze }.freeze
      end
    end
  end
end
