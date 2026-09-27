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
#   SENTRY_TRACES_SAMPLE_RATE   0.0..1.0, default 0.02 (2% of requests traced for performance
#                               data; tracing costs quota, 0 turns it off)
#   RAILWAY_GIT_COMMIT_SHA      set by Railway; used as the release
module VerseSentry
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

  module_function

  def enabled_by_env?(env = ENV, rails_env = Rails.env)
    env["SENTRY_DSN"].to_s.strip.present? && !rails_env.test?
  end

  # Only used once SENTRY_DSN is set, so without a DSN nothing is traced at all.
  DEFAULT_TRACES_SAMPLE_RATE = 0.02

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

if VerseSentry.enabled_by_env?
  Sentry.init { |config| VerseSentry.configure(config) }
end
