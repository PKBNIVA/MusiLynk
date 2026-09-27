# Cheap request metrics for the admin Operations view (GET /api/admin/operations): request
# count, 5xx rate and p95 latency for the last hour and day, without any new infrastructure.
#
# The middleware sits outside ActionDispatch::ShowExceptions, so it sees the status the
# client actually got (including 500s rendered for unhandled exceptions). Each request adds
# a few integers to an in-memory, per-process buffer; at most every FLUSH_SECONDS one request
# writes the buffer to request_metric_minutes (a single upsert plus a prune). Collection can
# never fail or slow a request beyond that write: every error is logged and the batch dropped.
module RequestMetrics
  # Platform health probes run every few seconds and would drown out real traffic.
  IGNORED_PATHS = %w[/api/live /api/health /api/readiness].freeze
  # Minutes kept in memory while writes are failing, so a database outage cannot grow the buffer.
  MAX_BUFFERED_MINUTES = 30

  class Buffer
    attr_accessor :flush_interval

    # flush_interval: seconds between writes; nil never writes on its own (tests call flush).
    def initialize(flush_interval:, clock: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) })
      @flush_interval = flush_interval
      @clock = clock
      @mutex = Mutex.new
      @pending = {}
      @last_flush = clock.call
    end

    def record(duration_ms, status, at: Time.now)
      batch = @mutex.synchronize do
        minute = at.to_i / 60 * 60
        count = (@pending[minute] ||= { requests: 0, server_errors: 0, histogram: Array.new(RequestMetric::BUCKETS, 0) })
        count[:requests] += 1
        count[:server_errors] += 1 if status.to_i >= 500
        count[:histogram][RequestMetric.bucket_for(duration_ms)] += 1
        @pending.delete(@pending.keys.min) while @pending.size > MAX_BUFFERED_MINUTES
        take_pending if flush_interval && @clock.call - @last_flush >= flush_interval
      end
      write(batch) if batch
    rescue StandardError => error
      report(error)
    end

    # Writes everything buffered so far. Returns false when the write failed.
    def flush
      write(@mutex.synchronize { take_pending })
    end

    def pending = @mutex.synchronize { @pending.transform_values(&:deep_dup) }

    def clear = @mutex.synchronize { @pending = {} }

    private

    def take_pending
      @last_flush = @clock.call
      batch = @pending
      @pending = {}
      batch
    end

    def write(batch)
      RequestMetric.connection_pool.with_connection { RequestMetric.add!(batch) }
      true
    rescue StandardError => error
      report(error)
      false
    end

    def report(error)
      Rails.logger.warn({ event: "request_metrics_write_failed", error: error.class.name, message: error.message.first(200) }.to_json)
    rescue StandardError
      nil
    end
  end

  class Middleware
    def initialize(app, buffer: RequestMetrics.buffer)
      @app = app
      @buffer = buffer
    end

    def call(env)
      return @app.call(env) unless tracked?(env["PATH_INFO"].to_s)

      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      begin
        status, headers, body = @app.call(env)
      rescue Exception # counted as a 500, then re-raised untouched
        observe(started, 500)
        raise
      end
      observe(started, status)
      [status, headers, body]
    end

    private

    def tracked?(path) = path.start_with?("/api/") && !IGNORED_PATHS.include?(path)

    def observe(started, status)
      @buffer.record(((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1_000).round(1), status)
    end
  end

  def self.buffer
    @buffer ||= Buffer.new(flush_interval: flush_interval_setting)
  end

  # REQUEST_METRICS_FLUSH_SECONDS (default 10). In tests nothing is written unless a test
  # flushes, so request query counts stay deterministic.
  def self.flush_interval_setting
    return nil if Rails.env.test?

    seconds = Integer(ENV.fetch("REQUEST_METRICS_FLUSH_SECONDS", "10"), exception: false)
    seconds&.positive? ? seconds : 10
  end
end

Rails.application.config.middleware.insert_before ActionDispatch::ShowExceptions, RequestMetrics::Middleware
