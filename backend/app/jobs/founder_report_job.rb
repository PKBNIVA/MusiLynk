# Weekly: builds the founder report for the Monday-to-Sunday week (IST) that just ended and queues
# one email per recipient (FounderReport.recipients: FOUNDER_REPORT_TO, else the active admins).
# Runs Monday 09:00 IST (03:30 UTC), see config/initializers/good_job.rb.
class FounderReportJob < ApplicationJob
  queue_as :scheduled

  def perform(now = Time.current)
    recipients = FounderReport.recipients
    return Rails.logger.warn({ event: "founder_report_skipped", reason: "no_recipients" }.to_json) if recipients.empty?

    data = FounderReport.new(now:).call
    content = FounderReportMail.render(data, now:)
    recipients.each { |to| FounderReportDeliveryJob.perform_later(to, content[:subject], content[:html], content[:text]) }
  end
end
