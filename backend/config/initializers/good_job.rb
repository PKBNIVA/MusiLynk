# Plain `require` (not autoloaded): this initializer runs before Zeitwerk's autoloading is set
# up, and AiPricing has no dependencies of its own beyond Rails.root/YAML, so requiring it
# directly here is safe regardless of load order.
require Rails.root.join("app/services/ai_pricing")

Rails.application.configure do
  config.good_job.execution_mode = ENV.fetch("GOOD_JOB_EXECUTION_MODE", Rails.env.production? ? "async" : "external").to_sym
  config.good_job.max_threads = ENV.fetch("GOOD_JOB_MAX_THREADS", "2").to_i
  config.good_job.poll_interval = ENV.fetch("GOOD_JOB_POLL_INTERVAL", "10").to_i
  config.good_job.enable_cron = ENV.fetch("GOOD_JOB_ENABLE_CRON", Rails.env.production?.to_s) == "true"
  config.good_job.preserve_job_records = true
  config.good_job.retry_on_unhandled_error = false
  # Errors inside GoodJob itself (not in a job) go to the error tracker; job failures are
  # reported by ApplicationJob#after_discard. Both are no-ops without SENTRY_DSN.
  config.good_job.on_thread_error = ->(error) { ErrorReporter.capture(error, tags: { source: "good_job_thread" }) }
  cron = {
    job_alert_sweep: {
      cron: "*/15 * * * *",
      class: "JobAlertSweepJob",
      description: "Deliver due daily and weekly job alerts"
    },
    auth_cleanup: {
      cron: "17 3 * * *",
      class: "AuthCleanupJob",
      description: "Delete expired sessions and email tokens expired or used more than 7 days ago"
    },
    billing_reconciliation: {
      cron: "7,37 * * * *",
      class: "BillingReconciliationJob",
      description: "Reconcile or expire stuck billing attempts and unissued booking payments"
    },
    upload_sweep: {
      cron: "43 4 * * *",
      class: "UploadSweepJob",
      description: "Delete stale pending uploads, unused or ownerless uploads, and orphaned bucket objects"
    },
    # 09:30 IST == 04:00 UTC (GoodJob cron times are UTC, like every other entry here).
    billing_reminders: {
      cron: "0 4 * * *",
      class: "BillingRemindersJob",
      description: "Email trial/renewal/Early Access Pro ending reminders, each sent at most once"
    },
    lifecycle_emails: {
      cron: "0 * * * *",
      class: "LifecycleEmailsJob",
      description: "Send the day-N onboarding sequence email to musicians and hirers whose condition still holds"
    },
    weekly_digest: {
      # Tuesday 09:30 IST = 04:00 UTC.
      cron: "0 4 * * 2",
      class: "WeeklyDigestJob",
      description: "Send the weekly 'This week on Verse' digest"
    },
    urgent_requests_sweep: {
      cron: "*/30 * * * *",
      class: "UrgentRequestsSweepJob",
      description: "Warn hirers 6 hours before an urgent request expires, and expire lapsed ones"
    },
    jobs_deadline_sweep: {
      cron: "13 * * * *",
      class: "JobsDeadlineSweepJob",
      description: "Close published jobs past their application deadline and notify the hirer"
    }
  }
  # classify_portfolio_item is launch-disabled (see config/ai_pricing.yml `launch:`), so the cron
  # entry itself is left out — GoodJob never enqueues AiBatchSubmitJob at all, rather than
  # enqueuing it to find nothing queued. Re-enabling the task brings the cron entry straight back,
  # no code change needed. (AiBatchSubmitJob also no-ops if it's ever run directly while
  # disabled — see its own disabled? guard — as a second line of defense.)
  cron[:ai_batch_submit] = {
    cron: "*/30 * * * *",
    class: "AiBatchSubmitJob",
    description: "Submit queued portfolio item classifications as one Anthropic Message Batch, and ingest finished batches"
  } if AiPricing.task_enabled?("classify_portfolio_item")
  config.good_job.cron = cron
end
