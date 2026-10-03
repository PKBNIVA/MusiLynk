# Plain `require` (not autoloaded): this initializer runs before Zeitwerk's autoloading is set
# up, and AiPricing has no dependencies of its own beyond Rails.root/YAML, so requiring it
# directly here is safe regardless of load order.
require Rails.root.join("app/services/ai_pricing")
require Rails.root.join("config/job_queues")

Rails.application.configure do
  config.good_job.execution_mode = ENV.fetch("GOOD_JOB_EXECUTION_MODE", Rails.env.production? ? "async" : "external").to_sym
  config.good_job.max_threads = ENV.fetch("GOOD_JOB_MAX_THREADS", "2").to_i
  # One thread pool per queue group (config/job_queues.yml), so urgent alerts never wait behind digests.
  config.good_job.queues = JobQueues.queue_string
  config.good_job.poll_interval = ENV.fetch("GOOD_JOB_POLL_INTERVAL", "10").to_i
  config.good_job.enable_cron = ENV.fetch("GOOD_JOB_ENABLE_CRON", Rails.env.production?.to_s) == "true"
  config.good_job.preserve_job_records = true
  # GoodJob's own periodic cleanup uses the same window as the retention sweep (config/retention.yml).
  config.good_job.cleanup_preserved_jobs_before_seconds_ago = YAML.safe_load_file(Rails.root.join("config/retention.yml")).dig("rules", "good_jobs", "days").to_i * 86_400
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
      description: "Delete email tokens expired or used more than 7 days ago"
    },
    # 03:47 IST = 22:17 UTC, when traffic is lowest.
    retention_sweep: {
      cron: "17 22 * * *",
      class: "RetentionSweepJob",
      description: "Delete records past their retention window (config/retention.yml), in capped batches"
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
    tax_invoice_catch_up: {
      cron: "27 5 * * *",
      class: "TaxInvoiceCatchUpJob",
      description: "Issue subscription invoices that were waiting for the seller details in config/legal.yml"
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
      description: "Send the weekly 'This week on MusiLynk' digest"
    },
    urgent_requests_sweep: {
      cron: "*/30 * * * *",
      class: "UrgentRequestsSweepJob",
      description: "Warn hirers 6 hours before an urgent request expires, and expire lapsed ones"
    },
    urgent_match_sweep: {
      cron: "*/5 * * * *",
      class: "UrgentMatchSweepJob",
      description: "Re-enqueue matching for urgent requests whose first run never started or died part-way"
    },
    jobs_deadline_sweep: {
      cron: "13 * * * *",
      class: "JobsDeadlineSweepJob",
      description: "Close published jobs past their application deadline and notify the hirer"
    },
    stage_system_posts: {
      cron: "0 * * * *",
      class: "StageSystemPostsJob",
      description: "Post welcomes, verifications, urgent fills and the Monday roundup to The Stage as MusiLynk"
    },
    review_prompt_sweep: {
      cron: "12 * * * *",
      class: "ReviewPromptSweepJob",
      description: "Prompt both parties to review each other after an urgent fill or booking completion, and send the one 3-day reminder"
    },
    founder_report: {
      # Monday 09:00 IST = 03:30 UTC, after the Sunday-night week has closed in IST.
      cron: "30 3 * * 1",
      class: "FounderReportJob",
      description: "Email the founders last week's numbers (organic accounts only) and what needs them"
    },
    search_index_sweep: {
      cron: "21 2 * * *",
      class: "SearchIndexBackfillJob",
      kwargs: { missing_only: true },
      description: "Build the search documents of rows written without model callbacks (bulk inserts)"
    },
    sitemap_refresh: {
      cron: "23 * * * *",
      class: "SitemapRefreshJob",
      description: "Rebuild the sitemap into the cache (too slow to build inside a crawler's request)"
    },
    fast_responder_week: {
      # Monday 00:20 IST — after the week just ended, before that day's own urgent traffic.
      cron: "50 18 * * 0",
      class: "FastResponderWeekJob",
      description: "Award the weekly fast-responder badges per city and post the leaderboard to The Stage"
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
