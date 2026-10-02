# Recovery path for UrgentMatchJob (GoodJob does not retry unhandled errors, and an enqueue can fail or a worker
# can die mid-run). Runs every 5 minutes (see config/initializers/good_job.rb) and re-enqueues matching for open
# requests that are still "pending" after a minute, or stuck in "matching" past UrgentMatchJob::STALE_CLAIM.
# Idempotent: UrgentMatchJob claims the row with a conditional UPDATE, so a duplicate enqueue does nothing.
class UrgentMatchSweepJob < ApplicationJob
  queue_as :default

  PENDING_GRACE = 1.minute
  PER_RUN = 200

  def perform
    stuck = UrgentRequest.where(status: "open")
      .where("(match_status = 'pending' AND created_at < ?) OR (match_status = 'matching' AND updated_at < ?)",
        PENDING_GRACE.ago, UrgentMatchJob::STALE_CLAIM.ago)
      .order(:created_at).limit(PER_RUN).pluck(:id)
    stuck.each { |id| UrgentMatchJob.perform_later(id) }
    Rails.logger.info("UrgentMatchSweepJob re-enqueued #{stuck.size} request(s)") if stuck.any?
  end
end
