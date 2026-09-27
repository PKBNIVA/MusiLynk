require "test_helper"
require "minitest/mock"

# The admin Operations view: request metrics collected by RequestMetrics (a Rack
# middleware plus a per-process buffer flushed into request_metric_minutes) and the
# job, payment and email figures from OperationsSnapshot.
class AdminOperationsViewTest < ActionDispatch::IntegrationTest
  setup do
    @admin = create_user("Ops Admin", "ops-admin@example.com", "admin")
    @buffer = RequestMetrics.buffer
    @buffer.clear
  end

  teardown { @buffer.clear }

  test "only admins can read the operations view" do
    get "/api/admin/operations"
    assert_response :unauthorized
    %w[jobseeker employer].each do |role|
      user = create_user("Ops #{role}", "ops-#{role}@example.com", role)
      get "/api/admin/operations", headers: auth(session_for(user))
      assert_response :forbidden
      assert_equal "You do not have permission to perform this action", response.parsed_body["error"]
    end
  end

  test "API requests are counted with their status and latency; health probes are not" do
    get "/api/jobs"
    get "/api/jobs/does-not-exist"
    get "/api/live"
    get "/api/readiness"

    pending = @buffer.pending
    assert_equal 2, pending.values.sum { _1[:requests] }
    assert_equal 0, pending.values.sum { _1[:server_errors] }
    assert_equal 2, pending.values.sum { _1[:histogram].sum }

    assert @buffer.flush
    assert_empty @buffer.pending
    assert_equal 2, RequestMetric.summary(1.hour)[:requests]
  end

  test "an unhandled exception is counted as a 5xx and still raised" do
    middleware = RequestMetrics::Middleware.new(->(_env) { raise "boom" }, buffer: @buffer)
    assert_raises(RuntimeError) { middleware.call(Rack::MockRequest.env_for("/api/jobs")) }
    served = RequestMetrics::Middleware.new(->(_env) { [503, {}, ["down"]] }, buffer: @buffer)
    assert_equal 503, served.call(Rack::MockRequest.env_for("/api/jobs")).first
    untracked = RequestMetrics::Middleware.new(->(_env) { [200, {}, ["ok"]] }, buffer: @buffer)
    untracked.call(Rack::MockRequest.env_for("/rails/active_storage/x"))

    counts = @buffer.pending.values
    assert_equal 2, counts.sum { _1[:requests] }
    assert_equal 2, counts.sum { _1[:server_errors] }
  end

  test "a failing metrics write never fails the request and is logged" do
    previous = @buffer.flush_interval
    @buffer.flush_interval = 0
    logged = capture_log do
      RequestMetric.stub(:add!, ->(*) { raise ActiveRecord::StatementInvalid, "database is down" }) do
        get "/api/jobs"
        assert_response :success
        assert_equal false, @buffer.flush
      end
    end
    assert_includes logged, "request_metrics_write_failed"
    assert_empty @buffer.pending, "a failed batch is dropped, not retried forever"
  ensure
    @buffer.flush_interval = previous
  end

  test "recording errors are swallowed" do
    logged = capture_log do
      RequestMetric.stub(:bucket_for, ->(*) { raise "bad bucket" }) { @buffer.record(12, 200) }
    end
    assert_includes logged, "request_metrics_write_failed"
  end

  test "the buffer flushes on its own once the interval has passed" do
    now = 100.0
    buffer = RequestMetrics::Buffer.new(flush_interval: 10, clock: -> { now })
    buffer.record(40, 200)
    assert_equal 0, RequestMetric.count
    now += 10
    buffer.record(40, 500)
    assert_empty buffer.pending
    row = RequestMetric.sole
    assert_equal [2, 1], [row.requests, row.server_errors]
  end

  test "the in-memory buffer is bounded while writes are failing" do
    buffer = RequestMetrics::Buffer.new(flush_interval: nil)
    start = Time.utc(2026, 9, 27, 10)
    40.times { |i| buffer.record(10, 200, at: start + i.minutes) }
    assert_equal RequestMetrics::MAX_BUFFERED_MINUTES, buffer.pending.size
    assert_equal (start + 39.minutes).to_i, buffer.pending.keys.max
  end

  test "flushes from several processes sum into the same minute and old rows are pruned" do
    now = Time.utc(2026, 9, 27, 12, 30, 20)
    minute = (now.to_i / 60) * 60
    histogram = ->(fast, slow) { Array.new(RequestMetric::BUCKETS, 0).tap { _1[1] = fast; _1[9] = slow } }
    RequestMetric.add!({ minute => { requests: 10, server_errors: 1, histogram: histogram.(9, 1) } }, now:)
    RequestMetric.add!({ minute => { requests: 5, server_errors: 2, histogram: histogram.(4, 1) } }, now:)
    RequestMetric.add!({}, now:)

    row = RequestMetric.sole
    assert_equal [15, 3], [row.requests, row.server_errors]
    assert_equal 13, row.latency_histogram[1]
    assert_equal 2, row.latency_histogram[9]

    old = (now - 26.hours).to_i / 60 * 60
    RequestMetric.insert_all!([{ minute: Time.at(old).utc, requests: 1, server_errors: 0, latency_histogram: histogram.(1, 0) }])
    RequestMetric.add!({ minute => { requests: 1, server_errors: 0, histogram: histogram.(1, 0) } }, now:)
    assert_equal [Time.at(minute).utc], RequestMetric.pluck(:minute)
  end

  test "summaries give count, 5xx rate and p95 per window" do
    now = Time.utc(2026, 9, 27, 12, 30)
    bucket = ->(ms) { RequestMetric.bucket_for(ms) }
    recent = Array.new(RequestMetric::BUCKETS, 0).tap { _1[bucket.(20)] = 90; _1[bucket.(400)] = 10 }
    earlier = Array.new(RequestMetric::BUCKETS, 0).tap { _1[bucket.(20_000)] = 900 }
    RequestMetric.add!({
      (now - 5.minutes).to_i => { requests: 100, server_errors: 4, histogram: recent },
      (now - 3.hours).to_i => { requests: 900, server_errors: 0, histogram: earlier }
    }, now:)

    hour = RequestMetric.summary(1.hour, now:)
    assert_equal({ requests: 100, serverErrors: 4, serverErrorRate: 0.04, p95Ms: 500, p95OverMs: nil }, hour)
    day = RequestMetric.summary(24.hours, now:)
    assert_equal 1000, day[:requests]
    assert_nil day[:p95Ms]
    assert_equal 10_000, day[:p95OverMs]
    empty = RequestMetric.summary(1.hour, now: now + 2.days)
    assert_equal({ requests: 0, serverErrors: 0, serverErrorRate: nil, p95Ms: nil, p95OverMs: nil }, empty)

    assert_equal 0, RequestMetric.bucket_for(0)
    assert_equal 0, RequestMetric.bucket_for(5)
    assert_equal 1, RequestMetric.bucket_for(5.1)
    assert_equal RequestMetric::LATENCY_BOUNDS_MS.size, RequestMetric.bucket_for(10_001)
  end

  test "the admin view reports traffic, jobs, payments and email health" do
    now = Time.current
    minute = now.to_i
    RequestMetric.add!({ minute => { requests: 20, server_errors: 1, histogram: Array.new(RequestMetric::BUCKETS, 0).tap { _1[3] = 20 } } })
    seed_jobs(now)
    seed_payments(now)
    EmailSuppression.record!(email: "gone@example.com", event: "hard_bounce", at: now - 1.hour)
    EmailSuppression.record!(email: "full@example.com", event: "soft_bounce", at: now - 2.hours)
    EmailSuppression.record!(email: "old@example.com", event: "spam", at: now - 3.days)

    get "/api/admin/operations", headers: auth(session_for(@admin))
    assert_response :success
    body = response.parsed_body

    assert_equal({ "requests" => 20, "serverErrors" => 1, "serverErrorRate" => 0.05, "p95Ms" => 50, "p95OverMs" => nil }, body.dig("requests", "lastHour"))
    assert_equal 20, body.dig("requests", "last24Hours", "requests")
    assert body.dig("requests", "collectingSince")

    jobs = body["jobs"]
    assert_equal 2, jobs["queued"]
    assert_equal 1, jobs["running"]
    assert_equal 1, jobs["scheduled"]
    assert_in_delta 45.minutes.to_i, jobs["oldestQueuedAgeSeconds"], 5
    assert_equal 2, jobs["failed24h"], "a failure from two days ago is not counted"
    assert_equal({ "EmailDeliveryJob" => 1, "UploadSweepJob" => 1 }, jobs["failedByClass24h"])
    assert_equal 1, jobs["erroredRuns24h"]

    assert_equal({ "failed24h" => 1, "pending24h" => 1 }, body.dig("payments", "bookingPayments"))
    assert_equal({ "failed24h" => 1, "pending24h" => 2 }, body.dig("payments", "billingAttempts"))

    email = body["email"]
    assert_equal 1, email["deliveryFailures24h"]
    assert_equal 1, email["retriedSends24h"]
    assert_equal({ "hard_bounce" => 1, "soft_bounce" => 1 }, email["addressesReported24h"])
    assert_equal 2, email["suppressedAddresses"]
    assert_includes [true, false], email["webhookConfigured"]
    refute body.key?("backup"), "backup status lives in GitHub Actions, not the app"
  end

  test "an empty system reports zeros rather than failing" do
    get "/api/admin/operations", headers: auth(session_for(@admin))
    assert_response :success
    body = response.parsed_body
    assert_equal 0, body.dig("requests", "lastHour", "requests")
    assert_nil body.dig("requests", "collectingSince")
    assert_equal 0, body.dig("jobs", "queued")
    assert_nil body.dig("jobs", "oldestQueuedAgeSeconds")
  end

  private

  def seed_jobs(now)
    job = ->(**attrs) { GoodJob::Job.create!(active_job_id: SecureRandom.uuid, queue_name: "default", job_class: "UploadSweepJob", created_at: now - 1.hour, **attrs) }
    job.(scheduled_at: now - 45.minutes)
    job.(scheduled_at: now - 5.minutes, job_class: "JobAlertSweepJob")
    job.(scheduled_at: now + 1.hour)
    job.(scheduled_at: now - 2.minutes, performed_at: now - 1.minute)
    job.(scheduled_at: now - 3.hours, performed_at: now - 3.hours, finished_at: now - 3.hours)
    job.(scheduled_at: now - 3.hours, performed_at: now - 3.hours, finished_at: now - 2.hours, error: "RuntimeError: sweep failed")
    email = job.(job_class: "EmailDeliveryJob", scheduled_at: now - 3.hours, performed_at: now - 3.hours, finished_at: now - 1.hour, error: "ProviderUnavailable")
    job.(scheduled_at: now - 3.days, performed_at: now - 3.days, finished_at: now - 2.days, error: "RuntimeError: old")
    GoodJob::Execution.create!(active_job_id: email.active_job_id, job_class: "EmailDeliveryJob", queue_name: "mailers", scheduled_at: now - 3.hours, finished_at: now - 3.hours, error: "ProviderUnavailable", created_at: now - 3.hours)
    GoodJob::Execution.create!(active_job_id: email.active_job_id, job_class: "EmailDeliveryJob", queue_name: "mailers", scheduled_at: now - 2.days, finished_at: now - 2.days, error: "old", created_at: now - 2.days)
  end

  def seed_payments(now)
    payer = create_user("Ops Payer", "ops-payer@example.com", "employer")
    owner = create_user("Ops Owner", "ops-owner@example.com", "jobseeker")
    act = Act.create!(owner:, name: "Ops Act", act_type: "band", currency: "INR", fee_basis: "event", status: "active")
    payment = ->(status, at) do
      booking = BookingRequest.create!(act:, requester: payer, event_type: "concert", city: "Goa", currency: "INR", status: "accepted")
      booking.booking_payments.create!(payer:, kind: "deposit", amount: 100, currency: "INR", provider: "razorpay", status:, created_at: at, updated_at: at)
    end
    payment.("failed", now - 2.hours)
    payment.("failed", now - 3.days)
    payment.("created", now - 10.minutes)
    payment.("paid", now - 1.hour)
    attempt = ->(state, at) do
      BillingAttempt.create!(user: payer, operation: "subscription_create", provider: "razorpay", idempotency_key: "ops-#{SecureRandom.hex(6)}", state:, created_at: at, updated_at: at)
    end
    attempt.("failed", now - 1.hour)
    attempt.("failed", now - 2.days)
    attempt.("pending", now - 5.minutes)
    attempt.("ambiguous", now - 20.minutes)
    attempt.("succeeded", now - 20.minutes)
  end

  def capture_log
    io = StringIO.new
    sink = ActiveSupport::Logger.new(io)
    Rails.logger.broadcast_to(sink)
    yield
    io.string
  ensure
    Rails.logger.stop_broadcasting_to(sink)
  end

  def create_user(name, email, role)
    User.create!(name:, email:, password: "StrongPass123!", role:, status: "active").tap(&:create_profile!)
  end

  def auth(token) = { "Authorization" => "Bearer #{token}" }

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    raw
  end
end
