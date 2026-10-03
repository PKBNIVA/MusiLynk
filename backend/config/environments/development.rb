require "active_support/core_ext/integer/time"
Rails.application.configure do
  config.enable_reloading = true
  config.eager_load = false
  config.consider_all_requests_local = true
  config.active_storage.service = :local
  config.action_mailer.default_url_options = { host: "localhost", port: 5173 }

  # Every SQL statement carries a comment naming where it came from
  # (/*application:MusilynkApi,controller:talent,action:public_index*/), so a slow query in the log
  # or in pg_stat_statements points at its endpoint or job. Production logging is configured separately.
  config.active_record.query_log_tags_enabled = true
  config.active_record.query_log_tags = [:application, :controller, :action, :job]
  # Statements slower than this are logged at WARN with their source (config/initializers/slow_query_log.rb).
  config.x.slow_query_ms = 100
end
