module Verification
  # config/verification.yml, loaded once per process.
  module Config
    PATH = Rails.root.join("config/verification.yml")

    module_function

    def data = @data ||= YAML.safe_load_file(PATH, aliases: true).fetch(Rails.env).deep_symbolize_keys.freeze

    def reload! = @data = nil

    def auto_approve = data.fetch(:auto_approve)
    def summary_min_score = data.fetch(:summary_min_score)
    def rate_limit = data.fetch(:rate_limit)
    def pro = data.fetch(:pro)
    def disposable_domains = data.fetch(:disposable_email_domains).map(&:downcase)
  end
end
