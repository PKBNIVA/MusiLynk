# One row per minute of API traffic, summed across every web process: request count,
# 5xx count and a latency histogram. Written by RequestMetrics::Buffer (see
# config/initializers/request_metrics.rb) and read by the admin Operations view.
#
# The table is bounded: every write deletes rows older than RETENTION, so it holds at
# most about 1,500 small rows.
class RequestMetric < ApplicationRecord
  self.table_name = "request_metric_minutes"
  self.primary_key = "minute"

  # Upper edges (ms) of the latency buckets. A request lands in the first bucket whose
  # edge is >= its duration; anything slower goes in one extra overflow bucket.
  LATENCY_BOUNDS_MS = [5, 10, 25, 50, 75, 100, 150, 200, 300, 500, 750, 1_000, 1_500, 2_000, 3_000, 5_000, 10_000].freeze
  BUCKETS = LATENCY_BOUNDS_MS.size + 1
  RETENTION = 25.hours

  def self.bucket_for(duration_ms) = LATENCY_BOUNDS_MS.bsearch_index { duration_ms <= _1 } || LATENCY_BOUNDS_MS.size

  # Adds buffered counts: { minute_epoch_seconds => { requests:, server_errors:, histogram: [..] } }.
  # Rows for a minute another process already wrote are summed, bucket by bucket.
  def self.add!(counts, now: Time.current)
    return if counts.empty?

    rows = counts.map do |minute, count|
      { minute: Time.at(minute).utc, requests: count[:requests], server_errors: count[:server_errors], latency_histogram: count[:histogram] }
    end
    transaction do
      upsert_all(rows, unique_by: :minute, record_timestamps: false, on_duplicate: Arel.sql(<<~SQL.squish))
        requests = request_metric_minutes.requests + EXCLUDED.requests,
        server_errors = request_metric_minutes.server_errors + EXCLUDED.server_errors,
        latency_histogram = ARRAY(
          SELECT COALESCE(old, 0) + COALESCE(new, 0)
          FROM unnest(request_metric_minutes.latency_histogram, EXCLUDED.latency_histogram) WITH ORDINALITY AS h(old, new, i)
          ORDER BY i
        )
      SQL
      where(minute: ...(now - RETENTION)).delete_all
    end
  end

  # { requests:, serverErrors:, serverErrorRate:, p95Ms:, p95OverMs: } for the minutes in
  # the last `window`. p95Ms is the upper edge of the bucket holding the 95th percentile
  # (so "p95 <= p95Ms"); when that is the overflow bucket, p95Ms is nil and p95OverMs says
  # the p95 is above the largest edge.
  def self.summary(window, now: Time.current)
    scope = where(minute: (now - window)..)
    requests, server_errors = scope.pick(Arel.sql("COALESCE(SUM(requests), 0)"), Arel.sql("COALESCE(SUM(server_errors), 0)"))
    histogram = Array.new(BUCKETS, 0)
    scope.from("request_metric_minutes, unnest(latency_histogram) WITH ORDINALITY AS h(n, i)")
      .group("h.i").pluck(Arel.sql("h.i"), Arel.sql("SUM(h.n)"))
      .each { |index, n| histogram[index - 1] = n.to_i if index <= BUCKETS }
    p95_bucket = percentile_bucket(histogram, 0.95)
    {
      requests: requests.to_i,
      serverErrors: server_errors.to_i,
      serverErrorRate: requests.to_i.zero? ? nil : (server_errors.to_f / requests).round(4),
      p95Ms: p95_bucket && LATENCY_BOUNDS_MS[p95_bucket],
      p95OverMs: (LATENCY_BOUNDS_MS.last if p95_bucket == LATENCY_BOUNDS_MS.size)
    }
  end

  def self.percentile_bucket(histogram, fraction)
    total = histogram.sum
    return nil if total.zero?

    target = (total * fraction).ceil
    running = 0
    histogram.each_with_index do |n, index|
      running += n
      return index if running >= target
    end
  end
end
