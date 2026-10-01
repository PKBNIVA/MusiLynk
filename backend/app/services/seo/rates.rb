# Backs GET /api/public/rates/:city — median and interquartile range of what verified and
# unverified professionals report for session_rate, show_rate and day_rate (INR), per directory
# role, computed only from real profile data (never estimated).
module Seo
  class Rates
    MIN_SAMPLE = 5
    METRICS = %i[session_rate show_rate day_rate].freeze

    RateSummary = Struct.new(:n, :sessionRate, :showRate, :dayRate, :hasData, keyword_init: true)

    # `include_demo: true` is what a browser sees (badged demo-* profiles count); the default is organic
    # profiles only, which is what indexability and the sitemap use.
    def self.for_city(city_name, include_demo: false)
      Seo::Pages.roles.to_h do |slug, label|
        [slug, summary_for(label, city_name, include_demo:)]
      end
    end

    def self.summary_for(role_label, city_name, include_demo: false)
      scope = Seo::HireStats.scope_for(role_label, city_name, include_demo:)
        .where("profiles.currency IS NULL OR profiles.currency = ?", "INR")
        .where("profiles.session_rate IS NOT NULL OR profiles.show_rate IS NOT NULL OR profiles.day_rate IS NOT NULL")
      rows = scope.pluck(:session_rate, :show_rate, :day_rate)
      n = rows.length
      return RateSummary.new(n:, sessionRate: nil, showRate: nil, dayRate: nil, hasData: false) if n < MIN_SAMPLE

      session_values, show_values, day_values = rows.transpose
      RateSummary.new(
        n:,
        sessionRate: range_for(session_values),
        showRate: range_for(show_values),
        dayRate: range_for(day_values),
        hasData: true
      )
    end

    # { median:, p25:, p75:, n: } from the non-nil values, or nil when fewer than MIN_SAMPLE of
    # them exist (a role can have 5+ profiles overall but fewer with THIS particular rate filled in).
    def self.range_for(values)
      present = values.compact.sort
      return nil if present.length < MIN_SAMPLE
      { median: percentile(present, 50), p25: percentile(present, 25), p75: percentile(present, 75), n: present.length }
    end

    # Linear-interpolation percentile of an already-sorted array.
    def self.percentile(sorted, pct)
      return sorted.first if sorted.length == 1
      rank = (pct / 100.0) * (sorted.length - 1)
      lower = rank.floor
      upper = rank.ceil
      return sorted[lower] if lower == upper
      sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower)
    end
  end
end
