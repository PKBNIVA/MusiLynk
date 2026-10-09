# The one loader for every business-settings file under config/ (fees, plans, limits, catalog
# lists, feature flags, AI pricing, legal details, edge-cache lifetimes, SEO lists). Each file
# is read once per process and validated against a small schema at boot
# (config/initializers/settings.rb), so a typo or a missing key fails the deploy, not a request.
#
# Env-scoped files (`default:` + development/test/production with YAML aliases) are read for the
# current Rails.env; flat files are read whole. Keys come back deep-symbolized unless `symbolize:
# false`. The domain readers (BookingFeePolicy, AiPricing, LegalConfig, BillingConfig, PlanCatalog,
# Limits, Catalog, Features, EdgeCache, Seo::Pages) all go through Settings.load and keep their
# own small, named accessors, so callers never reach into raw hashes. Update path for every file:
# docs/engineering/SETTINGS.md.
module Settings
  class Invalid < StandardError; end

  BOOLEAN = [TrueClass, FalseClass].freeze

  # name => { env: scoped?, required: { key => type } , check: ->(config) { [errors] } }
  # Types: a Class/Module (Integer, Numeric, String, Hash, Array), :boolean, or an Array of
  # acceptable types (e.g. [Integer, NilClass] for "a number or null").
  FILES = {
    bookings: { env: true, required: { policy_version: Integer, platform_fee_percent: Numeric, fee_paid_by: String, min_fee_inr: Integer, gst_percent: Numeric, cancellation: Hash },
                check: ->(c) { Settings.range_errors(c, platform_fee_percent: 0..100, gst_percent: 0..100) + Settings.range_errors(c[:cancellation], full_refund_days: 0..365, partial_refund_days: 0..365, partial_refund_percent: 0..100) } },
    billing: { env: true, required: { early_access: Hash, codes: Hash, referral: Hash } },
    ai_pricing: { env: true, required: { allowances: Hash, topups: Hash, ai_plus: Hash, task_costs: Hash, long_tasks: Array, provider: String, providers: Hash, model_pricing: Hash, budgets: Hash, launch: Hash, output_caps: Hash, cache_ttl_hours: Integer } },
    legal: { env: true, required: { business: Hash, grievance_officer: Hash } },
    plans: { env: false, required: { plans: Hash }, check: ->(c) { Settings.plan_errors(c[:plans]) } },
    limits: { env: false, required: { auth: Hash, portfolio: Hash, paging: Hash, search: Hash, messages: Hash, jobs: Hash, push: Hash },
              check: ->(c) { Settings.positive_integer_errors(c) } },
    catalog: { env: false, required: { opportunity_kinds: Array, workplaces: Array, currencies: Array, act_types: Array, event_types: Array, engagement_types: Array, role_categories: Hash, instruments: Array, launch_cities: Array } },
    features: { env: false, required: { flags: Hash }, check: ->(c) { Settings.feature_errors(c[:flags]) } },
    edge_cache: { env: false, required: { shared: Hash } },
    seo_pages: { env: false, required: { roles: Hash, cities: Hash } }
  }.freeze

  class << self
    def path(name) = Rails.root.join("config/#{name}.yml")

    # The parsed, env-scoped (where applicable) contents of config/<name>.yml.
    def load(name, symbolize: true)
      name = name.to_sym
      cache = symbolize ? symbolized : raw
      cache[name] ||= read(name, symbolize:)
    end

    def reload!(name = nil)
      if name
        symbolized.delete(name.to_sym)
        raw.delete(name.to_sym)
      else
        @symbolized = {}
        @raw = {}
      end
      nil
    end

    # Errors for one file as "file: message" strings; [] when the file is valid.
    def errors_for(name)
      spec = FILES.fetch(name.to_sym)
      config = load(name)
      return ["#{name}.yml: must be a mapping"] unless config.is_a?(Hash)

      errors = spec.fetch(:required, {}).flat_map { |key, type| type_errors(config, key, type) }
      errors += Array(spec[:check]&.call(config)) if errors.empty?
      errors.map { "#{name}.yml: #{_1}" }
    rescue Errno::ENOENT
      ["#{name}.yml: file is missing"]
    rescue Psych::SyntaxError => e
      ["#{name}.yml: #{e.message}"]
    end

    def validate!(name)
      errors = errors_for(name)
      raise Invalid, errors.join("\n") if errors.any?
      true
    end

    # Boot check: every known file parses and matches its schema.
    def validate_all!
      errors = FILES.keys.flat_map { errors_for(_1) }
      raise Invalid, "Invalid settings:\n#{errors.join("\n")}" if errors.any?
      true
    end

    # --- schema helpers (public so the lambdas in FILES can call them) ---

    def type_errors(config, key, type)
      return ["`#{key}` is missing"] unless config.key?(key)
      value = config[key]
      allowed = type == :boolean ? BOOLEAN : Array(type)
      allowed.any? { value.is_a?(_1) } ? [] : ["`#{key}` must be #{allowed.map(&:to_s).join(' or ')}, got #{value.inspect}"]
    end

    def range_errors(config, **ranges)
      ranges.flat_map do |key, range|
        value = config.is_a?(Hash) ? config[key] : nil
        value.is_a?(Numeric) && range.cover?(value) ? [] : ["`#{key}` must be a number in #{range}, got #{value.inspect}"]
      end
    end

    def positive_integer_errors(config, prefix = nil)
      config.flat_map do |key, value|
        path = [prefix, key].compact.join(".")
        case value
        when Hash then positive_integer_errors(value, path)
        when Integer then value.positive? ? [] : ["`#{path}` must be a positive integer, got #{value}"]
        else ["`#{path}` must be a positive integer, got #{value.inspect}"]
        end
      end
    end

    PLAN_FIELDS = { code: String, name: String, monthly: [Integer, NilClass], annual: [Integer, NilClass], trial_days: Integer, active_posts: Integer, seats: Integer, shortlist: Integer, bookings: Integer }.freeze

    def plan_errors(plans)
      return ["`plans` must have at least one plan"] if plans.blank?
      plans.flat_map do |key, plan|
        next ["plan `#{key}` must be a mapping"] unless plan.is_a?(Hash)
        errors = PLAN_FIELDS.flat_map { |field, type| type_errors(plan, field, type).map { "plan `#{key}`: #{_1}" } }
        errors << "plan `#{key}`: `code` must equal its key" if plan[:code].is_a?(String) && plan[:code] != key.to_s
        errors
      end
    end

    def feature_errors(flags)
      flags.flat_map do |name, flag|
        next ["flag `#{name}` must be a mapping"] unless flag.is_a?(Hash)
        next ["flag `#{name}` must be lower_snake_case"] unless name.to_s.match?(/\A[a-z][a-z0-9_]*\z/)
        errors = type_errors(flag, :enabled, :boolean)
        errors += range_errors(flag, percentage: 0..100) if flag.key?(:percentage)
        errors << "`allowlist` must be a list" if flag.key?(:allowlist) && !flag[:allowlist].is_a?(Array)
        errors.map { "flag `#{name}`: #{_1}" }
      end
    end

    private

    def symbolized = (@symbolized ||= {})
    def raw = (@raw ||= {})

    def read(name, symbolize:)
      spec = FILES.fetch(name) { raise ArgumentError, "unknown settings file #{name}" }
      data = YAML.safe_load(File.read(path(name)), aliases: true) || {}
      data = data.fetch(Rails.env, {}) if spec[:env]
      symbolize && data.is_a?(Hash) ? data.deep_symbolize_keys : data
    end
  end
end
