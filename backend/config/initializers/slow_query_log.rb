# Slow SQL (at least config.x.slow_query_ms) is logged at WARN as a JSON line whose statement
# is fingerprinted, never with bind or literal values (SlowQueryLog, SqlFingerprint). The
# threshold is set per environment: development 100 ms (config/environments/development.rb),
# production SLOW_QUERY_MS with a 100 ms default (config/environments/production.rb); unset
# (test) means nothing is subscribed. See docs/ops/observability.md.
# (`config.x.<unset>` answers an empty options object, not nil, hence the Numeric check.)
Rails.application.config.after_initialize do
  threshold = Rails.configuration.x.slow_query_ms
  SlowQueryLog.subscribe(threshold_ms: threshold) if threshold.is_a?(Numeric)
end
