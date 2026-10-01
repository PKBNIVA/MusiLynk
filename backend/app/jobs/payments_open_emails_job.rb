# Fans the payments-open email out to every member waiting for it (PaymentsOpenEmails).
# Enqueued by an admin; it does nothing while payments are not usable.
class PaymentsOpenEmailsJob < ApplicationJob
  queue_as :mailers

  def perform
    result = PaymentsOpenEmails.call
    Rails.logger.info({ event: "payments_open_emails", jobId: job_id, sent: result.sent, skipped: result.skipped }.to_json)
  end
end
