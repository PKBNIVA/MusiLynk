# Logs every SQL statement that took at least `threshold_ms` as one JSON line, with the
# statement fingerprinted (SqlFingerprint: no literal values) and the query-log tag that names
# the controller or job. Subscribed at boot by config/initializers/slow_query_log.rb whenever
# config.x.slow_query_ms is set (development: 100; production: SLOW_QUERY_MS, default 100).
module SlowQueryLog
  EVENT = "slow_query".freeze
  SKIPPED = %w[SCHEMA TRANSACTION].freeze

  module_function

  def subscribe(threshold_ms:, logger: Rails.logger)
    threshold = Float(threshold_ms)
    ActiveSupport::Notifications.subscribe("sql.active_record") do |event|
      next if event.duration < threshold || SKIPPED.include?(event.payload[:name])
      logger.warn(line(event).to_json)
    end
  end

  def line(event)
    {
      event: EVENT,
      durationMs: event.duration.round(1),
      name: event.payload[:name],
      sql: SqlFingerprint.call(event.payload[:sql]),
      # The controller#action or job class ActiveRecord::QueryLogs tagged the statement with, if on.
      source: event.payload[:sql].to_s[/\/\*(.*?)\*\//, 1]&.strip,
      cached: (true if event.payload[:cached])
    }.compact
  end
end
