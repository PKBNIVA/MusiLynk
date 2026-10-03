# One JSON line per request (RequestLog) instead of Rails' "Started / Processing by /
# Completed" lines. The whole request-log configuration lives here; the line's fields and the
# privacy rules are in app/services/request_log.rb, and docs/ops/observability.md says how to
# read them on Railway. Health probes of /api/live stay out (config.silence_healthcheck_path).
#
# App constants are only referenced inside lambdas: initializers run before autoloading is
# allowed, lograge calls these once the app is up.
Rails.application.configure do
  # LOGRAGE=false restores Rails' multi-line request log in development only; production
  # (and test, which asserts the line's shape) always writes the single JSON line.
  config.lograge.enabled = !(Rails.env.development? && ENV["LOGRAGE"] == "false")
  config.lograge.formatter = ->(data) { RequestLog.format(data) }
  # API-only app: controllers inherit from ActionController::API, not ::Base.
  config.lograge.base_controller_class = ["ActionController::API"]
  config.lograge.custom_options = ->(event) { RequestLog.options(event) }
  config.lograge.custom_payload { |controller| RequestLog.payload(controller) }
end
