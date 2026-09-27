# Postgres session limits applied to every connection through `variables:` in
# config/database.yml. Loaded from that file's ERB, so it must not depend on autoloading.
#
# Three kinds of process get different limits:
# - web (Puma, and jobs run in-process when GOOD_JOB_EXECUTION_MODE=async): short limits so a
#   runaway query or a blocked lock fails fast instead of pinning a Puma thread and a
#   pool connection until the request queue backs up.
# - worker (`good_job start`): longer limits, because jobs legitimately batch through
#   whole tables. GoodJob's LISTEN connection blocks in libpq's wait_for_notify, which is
#   not a statement, so statement_timeout never interrupts it.
# - migration (any `db:*` rake task, e.g. db:prepare in the pre-deploy step): no limit by
#   default, so a long data migration or index build is never cut off half way.
#
# Each limit is env-overridable and accepts Postgres duration syntax ("15s", "500ms",
# "5min") or "0" for no limit. Anything else falls back to the default.
module DatabaseSessionSettings
  DURATION = /\A\d+(?:ms|s|min|h)?\z/

  DEFAULTS = {
    web: { statement_timeout: ["DB_STATEMENT_TIMEOUT", "15s"], lock_timeout: ["DB_LOCK_TIMEOUT", "5s"] },
    worker: { statement_timeout: ["WORKER_DB_STATEMENT_TIMEOUT", "5min"], lock_timeout: ["WORKER_DB_LOCK_TIMEOUT", "30s"] },
    migration: { statement_timeout: ["DB_MIGRATION_STATEMENT_TIMEOUT", "0"], lock_timeout: ["DB_MIGRATION_LOCK_TIMEOUT", "0"] }
  }.freeze

  module_function

  def variables(env: ENV, role: current_role)
    DEFAULTS.fetch(role).transform_values do |(name, default)|
      value = env[name].to_s.strip
      value.match?(DURATION) ? value : default
    end
  end

  def current_role(rake_tasks: top_level_rake_tasks, good_job_cli: good_job_cli?)
    return :migration if rake_tasks.any? { _1.start_with?("db:") }
    return :worker if good_job_cli
    :web
  end

  # Runs the block with `limits` set on `connection`, then puts back whatever the session
  # had before. Used by ApplicationJob so jobs run in-process (GOOD_JOB_EXECUTION_MODE=async)
  # get the worker limits instead of the web ones. SHOW bypasses the query cache so a
  # nested job reads the live value. If the old values cannot be restored outside a
  # transaction, the connection is dropped from the pool rather than handed to a request
  # with the longer limits. Inside a caller's transaction a failed restore means that
  # transaction is aborted; its rollback undoes the SETs, and dropping the connection would
  # break the caller.
  def with_limits(connection, limits)
    previous = connection.uncached { limits.keys.to_h { [_1, connection.select_value(show_sql(_1))] } }
    apply(connection, limits)
    yield
  ensure
    begin
      apply(connection, previous) if previous
    rescue StandardError
      connection.throw_away! unless connection.transaction_open?
    end
  end

  def apply(connection, limits)
    limits.each { |name, value| connection.execute(set_sql(name, connection.quote(value))) }
  end

  SETTING_SQL = {
    statement_timeout: ["SHOW statement_timeout", "SET SESSION statement_timeout = %s"],
    lock_timeout: ["SHOW lock_timeout", "SET SESSION lock_timeout = %s"]
  }.freeze

  def show_sql(name) = SETTING_SQL.fetch(name).first

  def set_sql(name, quoted_value) = format(SETTING_SQL.fetch(name).last, quoted_value)

  def top_level_rake_tasks
    defined?(Rake.application) ? Array(Rake.application.top_level_tasks) : []
  end

  def good_job_cli?
    defined?(GoodJob::CLI) && GoodJob::CLI.respond_to?(:within_exe?) && GoodJob::CLI.within_exe? ? true : false
  end
end
