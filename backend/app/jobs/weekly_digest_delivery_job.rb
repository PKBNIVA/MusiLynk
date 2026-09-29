# Delivers one user's weekly digest. Sections are passed through as plain data (built by
# WeeklyDigest) so the job can be retried without recomputing the digest.
class WeeklyDigestDeliveryJob < ApplicationJob
  queue_as :mailers

  retry_on Faraday::ConnectionFailed, Faraday::TimeoutError, Faraday::SSLError, EmailDeliveryJob::ProviderUnavailable,
    wait: :polynomially_longer, attempts: 5

  def perform(user_id, sections, subject)
    user = User.find_by(id: user_id)
    return log_skip("recipient_missing") unless user
    return log_skip("recipient_ineligible") unless NotificationEmail.deliverable_to?(user, category: "digest")

    sections = sections.map { |s| s.deep_symbolize_keys }
    content = LifecycleMailer.render_digest(sections, user, subject:)
    return log_skip("empty_digest") unless content

    result = EmailDelivery.deliver_rendered(to: user.email, template: "weekly_digest", **content, raise_errors: true)
    raise EmailDeliveryJob::ProviderUnavailable, "email provider returned #{result[:status]}" if result[:status].to_i >= 500

    log_skip(result[:reason] || "rejected_#{result[:status]}") unless result[:delivered]
  end

  private

  def log_skip(reason)
    Rails.logger.warn({ event: "weekly_digest_skipped", jobId: job_id, reason: }.to_json)
  end
end
