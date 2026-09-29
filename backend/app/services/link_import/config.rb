# Loads config/link_import.yml once per process, the same pattern as AiPricing.
module LinkImport
  class Config
    PATH = Rails.root.join("config/link_import.yml")

    def self.data
      @data ||= YAML.safe_load(File.read(PATH)).deep_symbolize_keys
    end

    def self.reload! = @data = nil

    def self.allowlisted_hosts = data.fetch(:allowlisted_hosts, [])
    def self.link_in_bio_hosts = data.fetch(:link_in_bio_hosts, [])
  end
end
