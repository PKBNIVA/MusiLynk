# Development only: logs every SQL statement that took at least config.x.slow_query_ms (100 ms in
# config/environments/development.rb) at WARN, with the query-log tags that name the endpoint or job,
# so a slow query shows up while the page is being built rather than at seeded volume or in
# production. Bind values are not logged. Production query logging is configured separately.
if Rails.env.development? && Rails.configuration.x.slow_query_ms
  threshold = Rails.configuration.x.slow_query_ms.to_f
  ActiveSupport::Notifications.subscribe("sql.active_record") do |event|
    next if event.duration < threshold || %w[SCHEMA TRANSACTION].include?(event.payload[:name])
    Rails.logger.warn("[slow query] #{event.duration.round(1)} ms #{event.payload[:name]}: #{event.payload[:sql].squish.first(2_000)}")
  end
end
