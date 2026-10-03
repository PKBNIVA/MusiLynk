module Search
  # Tuning values from config/search.yml (see docs/ops/search.md), loaded once per process.
  module Settings
    PATH = Rails.root.join("config/search.yml")

    module_function

    def count_cap = data.fetch("count_cap")
    def typo_min_results = data.fetch("typo_min_results")
    def spelling_threshold = data.fetch("spelling_threshold")
    def fuzzy_word_threshold = data.fetch("fuzzy_word_threshold")
    def spelling_db_rows_per_source = data.fetch("spelling_db_rows_per_source")
    def prefix_min_length = data.fetch("prefix_min_length")
    def statement_timeout_ms = data.fetch("statement_timeout_ms")
    def suggest = data.fetch("suggest")

    def data
      @data ||= YAML.safe_load_file(PATH).freeze
    end
  end
end
