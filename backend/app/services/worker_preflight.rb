# Checks run by bin/worker before `good_job start` on a separate worker service.
#
# The worker deploys from the same commit as the web service, but migrations run in the
# web service's pre-deploy step, so a worker can boot before the schema it expects exists.
# It waits (bounded) for pending migrations instead of running them itself, because two
# services migrating at once makes one fail with ActiveRecord::ConcurrentMigrationError.
class WorkerPreflight
  class NotAllowed < StandardError; end

  def initialize(env: ENV, clock: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }, sleeper: ->(seconds) { sleep(seconds) },
    migrations_pending: -> { ActiveRecord::Base.connection_pool.migration_context.needs_migration? }, logger: Rails.logger)
    @env = env
    @clock = clock
    @sleeper = sleeper
    @migrations_pending = migrations_pending
    @logger = logger
  end

  def call
    ensure_uploads_reachable!
    wait_for_migrations
  end

  # Upload files on the persistent disk live on a volume only the web service can mount.
  # A worker without it would delete Upload rows while their files stay on that volume.
  def ensure_uploads_reachable!
    return if !Rails.env.production? || UploadStorage.direct? || @env["WORKER_ALLOW_DISK_UPLOADS"] == "true"

    raise NotAllowed, "A separate job worker needs S3-compatible uploads (AWS_BUCKET). Configure R2 first, " \
      "or set WORKER_ALLOW_DISK_UPLOADS=true to accept that upload cleanup cannot remove files on the web volume."
  end

  # Returns true once the schema is current, false if the wait ran out (the worker then
  # starts anyway; jobs touching new columns fail and are retried or reported).
  def wait_for_migrations
    deadline = @clock.call + @env.fetch("WORKER_MIGRATION_WAIT_SECONDS", "600").to_i
    loop do
      return true unless @migrations_pending.call
      if @clock.call >= deadline
        @logger.warn({ event: "worker_migration_wait_expired" }.to_json)
        return false
      end
      @logger.info({ event: "worker_waiting_for_migrations" }.to_json)
      @sleeper.call(5)
    end
  end
end
