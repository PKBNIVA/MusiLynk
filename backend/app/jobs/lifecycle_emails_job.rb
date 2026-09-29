# Hourly: runs the day-N onboarding sequence for musicians and hirers (LifecycleSequences).
# Each step checks its own condition again right before sending and is idempotent via the
# lifecycle_emails table, so running this every hour is safe.
class LifecycleEmailsJob < ApplicationJob
  queue_as :scheduled

  def perform(now = Time.current)
    LifecycleSequences.run(now)
  end
end
