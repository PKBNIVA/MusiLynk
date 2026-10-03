# Nightly retention sweep (config/retention.yml, docs/ops/retention.md): deletes records past their
# window in batches, capped per rule per run, one log line per rule with counts only.
class RetentionSweepJob < ApplicationJob
  queue_as :scheduled

  def perform(dry_run: false) = Retention.sweep(dry_run:)
end
