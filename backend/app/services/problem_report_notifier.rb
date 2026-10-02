# Tells the founder a problem report arrived. One email per recipient through the same
# EmailDeliveryJob path as the vouch invite: a link to the admin console, never the report text
# and never the screenshot (the screenshot is only served to a signed-in admin, by a short-lived link).
#
# Recipients: FOUNDER_REPORT_TO (comma separated) when set, else ADMIN_EMAIL. With neither, or no
# email provider, nothing is sent and nothing fails: the report is still in the admin tab.
module ProblemReportNotifier
  TEMPLATE = "problem_report".freeze
  # The admin console tab (src/app/pages/admin/shared.tsx ADMIN_TABS).
  TAB = "problems".freeze
  # Emails per hour across all reports, so a flood of submissions cannot flood the inbox.
  EMAILS_PER_HOUR = 30

  module_function

  def recipients
    configured = ENV["FOUNDER_REPORT_TO"].to_s.split(/[,;\s]+/).map(&:strip).reject(&:blank?).uniq
    return configured if configured.any?

    ENV["ADMIN_EMAIL"].to_s.strip.presence ? [ENV["ADMIN_EMAIL"].to_s.strip] : []
  end

  def link(report) = "#{FounderReport.admin_url(TAB)}&report=#{report.id}"

  def notify(report)
    to = recipients
    return false if to.empty? || !EmailDelivery.configured?
    return false unless within_budget?

    name = report.user&.name.presence || "a visitor"
    to.each do |email|
      EmailDeliveryJob.enqueue_link_with_name(template: TEMPLATE, link: link(report), email:, name: name.to_s.first(80))
    end
    true
  rescue StandardError => error
    ErrorReporter.capture(error, tags: { source: "problem_report_notify" })
    false
  end

  def within_budget?
    window = Time.current.to_i / 1.hour.to_i
    count = Rails.cache.increment("problem-report-email:#{window}", 1, expires_in: 1.hour)
    count.nil? || count <= EMAILS_PER_HOUR
  end
end
