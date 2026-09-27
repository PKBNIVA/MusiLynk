require Rails.root.join("config/database_session_settings").to_s

class ApplicationJob < ActiveJob::Base
  retry_on ActiveRecord::Deadlocked, wait: :polynomially_longer, attempts: 5
  discard_on ActiveJob::DeserializationError

  # Jobs get the worker database limits (5min statements, 30s lock waits by default) even
  # when GoodJob runs them inside the web process (GOOD_JOB_EXECUTION_MODE=async); the
  # connection goes back to the pool with the limits it had. See
  # config/database_session_settings.rb.
  around_perform do |_job, block|
    limits = DatabaseSessionSettings.variables(role: :worker)
    DatabaseSessionSettings.with_limits(ActiveRecord::Base.lease_connection, limits) { block.call }
  end

  # Runs once when a job is given up on: discarded, retries exhausted, or an unhandled error
  # (GoodJob does not retry those: retry_on_unhandled_error = false).
  after_discard { |job, error| ErrorReporter.capture_job_failure(job, error) }
end
