# Daily housekeeping for email tokens that expired or were used more than RETENTION ago.
# Expired sessions and sign-in codes are deleted by RetentionSweepJob, on the windows in
# config/retention.yml.
class AuthCleanupJob < ApplicationJob
  RETENTION = 7.days
  BATCH_SIZE = 1_000

  queue_as :scheduled

  def perform(now = Time.current)
    cutoff = now - RETENTION
    tokens = delete_in_batches(EmailToken.where(expires_at: ...cutoff).or(EmailToken.where(used_at: ...cutoff)))
    Rails.logger.info({ event: "auth_cleanup", emailTokensDeleted: tokens }.to_json)
  end

  private

  def delete_in_batches(scope)
    deleted = 0
    scope.in_batches(of: BATCH_SIZE) { |batch| deleted += batch.delete_all }
    deleted
  end
end
