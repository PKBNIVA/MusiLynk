# Sends one rendered founder report to one address, so a retry never re-sends to the others.
class FounderReportDeliveryJob < ApplicationJob
  queue_as :mailers

  retry_on Faraday::ConnectionFailed, Faraday::TimeoutError, Faraday::SSLError, EmailDeliveryJob::ProviderUnavailable,
    wait: :polynomially_longer, attempts: 5

  def perform(to, subject, html, text)
    result = EmailDelivery.deliver_rendered(to:, template: "founder_report", subject:, html:, text:, raise_errors: true)
    raise EmailDeliveryJob::ProviderUnavailable, "email provider returned #{result[:status]}" if result[:status].to_i >= 500

    Rails.logger.warn({ event: "founder_report_not_delivered", jobId: job_id, reason: result[:reason] || "rejected_#{result[:status]}" }.to_json) unless result[:delivered]
  end
end
