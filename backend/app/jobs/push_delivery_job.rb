# Sends one web push to every device a user subscribed, off the request path (queued from
# Notifier through PushNotifications.notify). A subscription the push service reports gone
# (404/410) is deleted; any other failure is counted and the device is skipped with an
# exponential back-off (PushSubscription.sendable) until it answers again, and dropped after
# PushSubscription::MAX_FAILURES in a row. Nothing is retried by the queue, so a down push
# service never piles up jobs. Never logs endpoints, keys or payload text.
class PushDeliveryJob < ApplicationJob
  # Urgent-hire pushes ride the urgent pool (config/job_queues.yml); the rest go with the mail.
  queue_as { JobQueues.urgent_push?(arguments[1]) ? JobQueues::URGENT : "mailers" }
  discard_on ActiveJob::DeserializationError

  def perform(user_id, category, payload)
    return unless PushNotifications.enabled?

    user = User.includes(:profile).find_by(id: user_id)
    # Re-checked here: the user may have switched the category off since it was queued.
    return unless user && PushNotifications.category_enabled?(user, category)

    sent = gone = failed = 0
    user.push_subscriptions.sendable.find_each do |subscription|
      case PushNotifications.deliver(subscription, payload, category:).status
      when :sent
        subscription.record_success!
        sent += 1
      when :gone
        subscription.destroy
        gone += 1
      else
        subscription.record_failure!
        failed += 1
      end
    end
    Rails.logger.info({ event: "push_delivery", jobId: job_id, category:, sent:, gone:, failed: }.to_json) if sent + gone + failed > 0
  end
end
