# Delivers one onboarding-sequence step or milestone email (see LifecycleMailer). Mirrors
# NotificationEmailJob's split (render here, EmailDelivery owns the provider), but also
# checks the step's granular preference category, not just the master switch.
class LifecycleEmailDeliveryJob < ApplicationJob
  queue_as :mailers

  retry_on Faraday::ConnectionFailed, Faraday::TimeoutError, Faraday::SSLError, EmailDeliveryJob::ProviderUnavailable,
    wait: :polynomially_longer, attempts: 5

  def perform(user_id, key, params = {})
    user = User.find_by(id: user_id)
    return log_skip("recipient_missing", key) unless user

    category = LifecycleMailer.step_category(key)
    return log_skip("recipient_ineligible", key) unless NotificationEmail.deliverable_to?(user, category:)

    content = LifecycleMailer.render_step(key, params, user)
    result = EmailDelivery.deliver_rendered(to: user.email, template: key, **content, raise_errors: true)
    raise EmailDeliveryJob::ProviderUnavailable, "email provider returned #{result[:status]}" if result[:status].to_i >= 500

    log_skip(result[:reason] || "rejected_#{result[:status]}", key) unless result[:delivered]
  rescue KeyError
    log_skip("unknown_template", key)
  end

  private

  def log_skip(reason, key)
    Rails.logger.warn({ event: "lifecycle_email_skipped", jobId: job_id, key:, reason: }.to_json)
  end
end
