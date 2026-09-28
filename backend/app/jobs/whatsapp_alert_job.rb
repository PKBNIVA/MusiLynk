# Delivers one WhatsApp urgent-hire alert (see WhatsappAlerts). Retried through GoodJob on a
# network/HTTP failure; a permanently missing request or user is logged and dropped, not
# retried. Never touches the in-app/email side (Notifier) — those already went out
# synchronously from UrgentMatcher#notify_one before this job was enqueued.
class WhatsappAlertJob < ApplicationJob
  queue_as :mailers

  retry_on WhatsappAlerts::Error, Net::OpenTimeout, Net::ReadTimeout, wait: :polynomially_longer, attempts: 5

  def perform(urgent_request_id, user_id)
    urgent_request = UrgentRequest.find_by(id: urgent_request_id)
    user = User.find_by(id: user_id)
    return log_skip("target_missing") unless urgent_request && user

    result = WhatsappAlerts.send_urgent_alert(urgent_request, user)
    log_skip(result[:reason]) unless result[:sent]
  end

  private

  def log_skip(reason)
    Rails.logger.warn({ event: "whatsapp_alert_skipped", jobId: job_id, reason: }.to_json)
  end
end
