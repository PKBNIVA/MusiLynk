# Error tracking (Sentry).
#
# Completely inert unless SENTRY_DSN is set, and never active in the test environment
# (tests initialise the SDK themselves with a dummy transport). Without a DSN the
# sentry-rails middleware and ActiveJob hooks see `Sentry.initialized? == false` and
# do nothing, and ErrorReporter becomes a no-op.
#
# Variables (Railway):
#   SENTRY_DSN                  verse-api project DSN; unset = disabled
#   SENTRY_ENVIRONMENT          defaults to RAILS_ENV
#   SENTRY_TRACES_SAMPLE_RATE   0.0..1.0, default 0.1 (10% of requests and jobs traced for
#                               performance data; tracing costs quota, 0 turns it off).
#                               Profiling is always off.
#   RAILWAY_GIT_COMMIT_SHA      set by Railway; used as the release
module MusilynkSentry
  # Expected client errors: rescue_from turns these into 4xx responses. They are listed so a
  # manual ErrorReporter.capture (or an exception's cause chain) never reports them either.
  EXPECTED_CLIENT_ERRORS = %w[
    ActiveRecord::RecordNotFound
    ActiveRecord::RecordInvalid
    ActionController::RoutingError
    ActionController::ParameterMissing
    ActionController::BadRequest
  ].freeze

  # ActiveJob failures are reported by ApplicationJob's after_discard hook with the job
  # class and id only (never the arguments), so sentry-rails' own job capture is skipped.
  JOB_ADAPTERS = %w[
    ActiveJob::QueueAdapters::GoodJobAdapter
    GoodJob::Adapter
    ActiveJob::QueueAdapters::AsyncAdapter
    ActiveJob::QueueAdapters::InlineAdapter
    ActiveJob::QueueAdapters::TestAdapter
  ].freeze

  # Delivery to Sentry is best effort. The SDK's at_exit hook flushes pending client reports
  # synchronously and, when Sentry answers an error (a rejected DSN gives 403), raises
  # Sentry::ExternalError out of at_exit: Ruby then exits non-zero even though the work (a rake
  # task run as a Railway pre-deploy one-off, say) finished. A transport failure is logged
  # instead, so it can never change an exit status or fail a request or job.
  class Transport < Sentry::HTTPTransport
    def send_data(data)
      super
    rescue Sentry::ExternalError => error
      MusilynkSentry.log_delivery_failure(error)
      nil
    end

    def flush
      super
    rescue Sentry::ExternalError => error
      MusilynkSentry.log_delivery_failure(error)
      nil
    end
  end

  module_function

  def log_delivery_failure(error)
    # The first line only: the response body is not ours to copy into logs.
    Rails.logger.warn({ event: "sentry_delivery_failed", error: error.class.name, message: error.message.to_s.lines.first.to_s.strip.first(200) }.to_json)
  rescue StandardError
    nil
  end

  def enabled_by_env?(env = ENV, rails_env = Rails.env)
    env["SENTRY_DSN"].to_s.strip.present? && !rails_env.test?
  end

  # Only used once SENTRY_DSN is set, so without a DSN nothing is traced at all. Applies to
  # requests (sentry-rails middleware) and ActiveJob runs (its ActiveJob tracing subscriber).
  DEFAULT_TRACES_SAMPLE_RATE = 0.1

  def traces_sample_rate(value)
    raw = value.to_s.strip
    return DEFAULT_TRACES_SAMPLE_RATE if raw.empty?

    Float(raw).clamp(0.0, 1.0)
  rescue ArgumentError, TypeError
    DEFAULT_TRACES_SAMPLE_RATE
  end

  def configure(config, env: ENV)
    config.dsn = env["SENTRY_DSN"].to_s.strip
    config.environment = env["SENTRY_ENVIRONMENT"].presence || Rails.env.to_s
    config.release = env["RAILWAY_GIT_COMMIT_SHA"].presence if env["RAILWAY_GIT_COMMIT_SHA"].present?
    config.traces_sample_rate = traces_sample_rate(env["SENTRY_TRACES_SAMPLE_RATE"])
    # Performance tracing only; no CPU profiles (they need the stackprof gem and more quota).
    config.profiles_sample_rate = 0.0 if config.respond_to?(:profiles_sample_rate=)
    config.transport.transport_class = Transport

    # Privacy: no request bodies, cookies, query parameters, IPs or queue arguments.
    # (send_default_pii=false resets data_collection, so it is set first.)
    config.send_default_pii = false
    collection = config.data_collection
    collection.user_info = false
    collection.cookies.mode = :off
    collection.http_bodies = []
    collection.url_query_params.mode = :off
    collection.database_query_data = false
    collection.queues = false
    collection.stack_frame_variables = false

    config.excluded_exceptions += EXPECTED_CLIENT_ERRORS
    config.rails.skippable_job_adapters |= JOB_ADAPTERS
    config.rails.report_rescued_exceptions = true
    config.breadcrumbs_logger = []
    config.enable_logs = false if config.respond_to?(:enable_logs=)

    config.before_send = ->(event, hint) { ErrorScrubber.before_send(event, hint) }
    config.before_send_transaction = ->(event, hint) { ErrorScrubber.before_send(event, hint) }
    config
  end
end

if MusilynkSentry.enabled_by_env?
  Sentry.init { |config| MusilynkSentry.configure(config) }
end
