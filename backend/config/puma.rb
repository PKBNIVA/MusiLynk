max_threads_count = ENV.fetch("RAILS_MAX_THREADS", 5)
min_threads_count = ENV.fetch("RAILS_MIN_THREADS", max_threads_count)
threads min_threads_count, max_threads_count
port ENV.fetch("PORT", 3000)
environment ENV.fetch("RAILS_ENV", "development")
pidfile ENV["PIDFILE"] if ENV["PIDFILE"]
plugin :tmp_restart

# Cluster mode is opt-in: WEB_CONCURRENCY=N runs N worker processes, each with its own thread
# pool and database pool (so Postgres sees N x RAILS_MAX_THREADS web connections). Unset or 0/1
# keeps the single-process server. Background jobs are unaffected when they run in the separate
# GoodJob worker (GOOD_JOB_EXECUTION_MODE=external).
worker_count = Integer(ENV.fetch("WEB_CONCURRENCY", 0), exception: false).to_i
if worker_count > 1
  workers worker_count
  preload_app!
  # Each forked worker must open its own database connections.
  before_worker_boot { ActiveRecord::Base.establish_connection if defined?(ActiveRecord::Base) }
end
