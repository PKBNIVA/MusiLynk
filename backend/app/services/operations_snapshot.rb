# The numbers behind the admin Operations view (GET /api/admin/operations): API traffic,
# background jobs, payments and email deliverability. Every figure is a small indexed
# aggregate, so the page is cheap to load and safe to refresh.
#
# The nightly database backup runs in GitHub Actions (.github/workflows/db-backup.yml) and
# leaves no trace in the app's database, so its status is not reported here.
class OperationsSnapshot
  DAY = 24.hours
  EMAIL_JOBS = %w[EmailDeliveryJob NotificationEmailJob].freeze

  def initialize(now: Time.current)
    @now = now
  end

  def call
    {
      generatedAt: @now.iso8601,
      requests: requests,
      jobs: jobs,
      payments: payments,
      email: email
    }
  end

  private

  def since = @now - DAY

  def requests
    {
      lastHour: RequestMetric.summary(1.hour, now: @now),
      last24Hours: RequestMetric.summary(DAY, now: @now),
      collectingSince: RequestMetric.minimum(:minute)&.iso8601
    }
  end

  def jobs
    queued = GoodJob::Job.queued
    oldest = queued.minimum(:scheduled_at)
    failed = GoodJob::Job.discarded.where(finished_at: since..)
    {
      queued: queued.count,
      running: GoodJob::Job.running.count,
      # Future runs, including failed runs waiting for their next retry.
      scheduled: GoodJob::Job.unfinished.where("scheduled_at > ?", @now).count,
      oldestQueuedAt: oldest&.iso8601,
      oldestQueuedAgeSeconds: oldest && [(@now - oldest).round, 0].max,
      failed24h: failed.count,
      failedByClass24h: failed.group(:job_class).order(Arel.sql("COUNT(*) DESC")).limit(5).count,
      erroredRuns24h: GoodJob::Execution.where(created_at: since..).where.not(error: nil).count
    }
  end

  def payments
    {
      bookingPayments: {
        failed24h: BookingPayment.where(status: "failed", updated_at: since..).count,
        pending24h: BookingPayment.where(status: "created", created_at: since..).count
      },
      billingAttempts: {
        failed24h: BillingAttempt.where(state: "failed", updated_at: since..).count,
        pending24h: BillingAttempt.unresolved.where(created_at: since..).count
      }
    }
  end

  # Delivery failures are email jobs GoodJob gave up on (retries exhausted or an error that
  # is not retried). Bounces, complaints and unsubscribes come from the provider webhook.
  def email
    recent = EmailSuppression.where(last_event_at: since..)
    {
      deliveryFailures24h: GoodJob::Job.discarded.where(finished_at: since.., job_class: EMAIL_JOBS).count,
      retriedSends24h: GoodJob::Execution.where(created_at: since.., job_class: EMAIL_JOBS).where.not(error: nil).count,
      addressesReported24h: recent.group(:reason).count,
      suppressedAddresses: EmailSuppression.suppressed.count,
      webhookConfigured: ENV["BREVO_WEBHOOK_SECRET"].present?
    }
  end
end
