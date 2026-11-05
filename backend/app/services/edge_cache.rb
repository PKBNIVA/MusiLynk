# Loads config/edge_cache.yml once per process (same pattern as LegalConfig): the shared-cache
# lifetimes PublicCaching puts on anonymous public reads.
class EdgeCache
  CONFIG_PATH = Rails.root.join("config/edge_cache.yml")
  Lifetime = Struct.new(:s_maxage, :stale_while_revalidate, :max_age, keyword_init: true)

  class << self
    def config
      @config ||= Settings.load(:edge_cache, symbolize: false).fetch("shared").to_h do |kind, values|
        [kind.to_sym, Lifetime.new(**values.symbolize_keys.slice(*Lifetime.members))]
      end
    end

    def reload!
      @config = nil
      Settings.reload!(:edge_cache)
    end

    def kinds = config.keys

    # Raises KeyError for a kind the file does not know, so a typo fails the test suite, not production.
    def lifetime(kind) = config.fetch(kind.to_sym)
  end
end
