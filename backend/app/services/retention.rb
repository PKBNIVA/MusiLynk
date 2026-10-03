# Deletes records past their retention window (config/retention.yml, docs/ops/retention.md).
# RetentionSweepJob calls Retention.sweep nightly. Each rule deletes in batches of `batch_size`
# and at most `max_per_run` rows per run, and logs one line with counts only (never ids, names or
# contents). `dry_run: true` counts what would go (up to the same cap) and deletes nothing.
module Retention
  CONFIG_PATH = Rails.root.join("config/retention.yml")

  Outcome = Data.define(:rule, :count, :capped, :dry_run) do
    def log_line = { event: "retention_sweep", rule:, (dry_run ? :wouldDelete : :deleted) => count, capped:, dryRun: dry_run }
  end

  # rule => what "after" means for it and how its rows go. Each lambda gets the cutoff time and
  # returns the relation (or relations) whose rows are past it.
  RULES = {
    # A sign-in code is useless once expired; a day's grace keeps "code expired" answers accurate.
    "sign_in_codes" => { after: "expired", scopes: ->(cutoff) { [SignInCode.where(expires_at: ...cutoff)] } },
    # Expired by idle timeout or absolute lifetime; kept a week for "where am I signed in" and incident review.
    "sessions" => { after: "expired", scopes: ->(cutoff) { [Session.where("expires_at < :cutoff OR absolute_expires_at < :cutoff", cutoff:)] } },
    # Only read notifications; unread ones stay until they are read.
    "notifications" => { after: "read", scopes: ->(cutoff) { [Notification.where(read_at: ...cutoff)] } },
    # Only reports an admin has handled (triaged or resolved), counted from when they were handled
    # (or filed, for a report handled before handled_at existed): an untriaged report keeps its
    # screenshot however old. The file and its blob row go; the report (text, status, notes) stays.
    "problem_report_screenshots" => {
      after: "handled", files: true,
      scopes: ->(cutoff) { [ProblemReport.where.not(screenshot_blob_id: nil).where.not(status: "new").where("COALESCE(problem_reports.handled_at, problem_reports.created_at) < ?", cutoff)] }
    },
    # Analytics and funnel events. The admin funnel reads 7 or 30 days back and the founder report
    # two weeks; the 100-views milestone uses the stored profiles.profile_view_count instead.
    "product_events" => { after: "created", scopes: ->(cutoff) { [ProductEvent.where(created_at: ...cutoff)] } },
    # What AccountErasure keeps on purpose for a while after erasure (the anonymised user row,
    # messages, billing and audit records stay): the person's analytics events, and other people's
    # "recently viewed" entries that still carry the old name. Erased = status "deleted"; the time is
    # the user row's updated_at, which erasure sets.
    "erased_account_residue" => {
      after: "erased",
      scopes: lambda do |cutoff|
        erased = User.where(status: "deleted").where(updated_at: ...cutoff).select(:id)
        [ProductEvent.where(user_id: erased), RecentActivity.where(entity_id: erased)]
      end
    },
    # Finished (succeeded or discarded) GoodJob records with their executions.
    "good_jobs" => { after: "finished", good_job: true, scopes: ->(cutoff) { [GoodJob::Job.finished_before(cutoff)] } }
  }.freeze

  module_function

  def config
    @config ||= YAML.safe_load_file(CONFIG_PATH).tap do |raw|
      configured = raw.fetch("rules").keys.sort
      unless configured == RULES.keys.sort
        raise ArgumentError, "config/retention.yml rules #{configured.inspect} must match Retention::RULES #{RULES.keys.sort.inspect}"
      end
      raw.fetch("rules").each do |name, rule|
        raise ArgumentError, "#{name}: days must be a positive integer" unless rule["days"].is_a?(Integer) && rule["days"].positive?
        raise ArgumentError, "#{name}: after must be #{RULES[name][:after]}" unless rule["after"] == RULES[name][:after]
      end
    end.freeze
  end

  def window(name) = config.dig("rules", name, "days").days
  def batch_size = config.fetch("batch_size")
  def max_per_run = config.fetch("max_per_run")

  # Runs every rule (or `only`) and returns its outcomes; one log line per rule.
  def sweep(now: Time.current, dry_run: false, only: RULES.keys)
    only.map do |name|
      outcome = sweep_rule(name, now:, dry_run:)
      Rails.logger.info(outcome.log_line.to_json)
      outcome
    end
  end

  def sweep_rule(name, now: Time.current, dry_run: false)
    rule = RULES.fetch(name)
    cutoff = now - window(name)
    scopes = rule[:scopes].call(cutoff)
    remaining = max_per_run
    total = 0
    scopes.each do |scope|
      break if remaining <= 0
      count = if dry_run then [scope.limit(remaining).count, remaining].min
      elsif rule[:files] then purge_screenshots(scope, remaining)
      elsif rule[:good_job] then delete_good_jobs(scope, remaining)
      else delete_rows(scope, remaining)
      end
      total += count
      remaining -= count
    end
    Outcome.new(rule: name, count: total, capped: remaining <= 0 && more_left?(scopes), dry_run:)
  end

  def delete_rows(scope, limit)
    deleted = 0
    model = scope.klass
    while deleted < limit
      ids = scope.limit([batch_size, limit - deleted].min).pluck(model.primary_key)
      break if ids.empty?
      deleted += model.where(model.primary_key => ids).delete_all
    end
    deleted
  end

  # The file and blob row go (the same way ProblemReport's destroy callback removes them); the report stays.
  def purge_screenshots(scope, limit)
    purged = 0
    scope.includes(:screenshot_blob).limit(limit).find_each(batch_size:) do |report|
      blob = report.screenshot_blob
      report.update_columns(screenshot_blob_id: nil, updated_at: Time.current)
      if blob
        blob.delete
        ActiveStorage::Blob.where(id: blob.id).delete_all
      end
      purged += 1
    end
    purged
  end

  # GoodJob's own cleanup order: executions, then the job rows, by active_job_id.
  def delete_good_jobs(scope, limit)
    deleted = 0
    while deleted < limit
      ids = scope.order(finished_at: :asc).limit([batch_size, limit - deleted].min).pluck(:active_job_id)
      break if ids.empty?
      GoodJob::Execution.where(active_job_id: ids).delete_all
      deleted += GoodJob::Job.where(active_job_id: ids).delete_all
    end
    deleted
  end

  def more_left?(scopes) = scopes.any?(&:exists?)
end
