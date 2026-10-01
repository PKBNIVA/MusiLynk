# Sends transactional (token link or sign-in code) emails outside the request thread.
#
# The link or code is a single-use secret, so it is encrypted before it is
# written to the job table (GoodJob preserves job records and shows their
# arguments in its dashboard). The recipient is looked up by user id at
# delivery time so the job row holds no email address; a sign-up code, which
# has no user yet, carries its recipient address encrypted too.
#
# Arguments: (user_id, template, sealed_secret, sealed_email = nil). The first
# three keep the shape of jobs enqueued before sign-in codes existed.
class EmailDeliveryJob < ApplicationJob
  # Raised for provider 5xx responses so they are retried like network errors.
  class ProviderUnavailable < StandardError; end

  LINK_PURPOSE = :email_delivery_link
  RECIPIENT_PURPOSE = :email_delivery_recipient
  NAME_PURPOSE = :email_delivery_name
  CODE_TEMPLATES = %w[sign_in_code admin_email_change account_email_change].freeze
  # Security notices carry a detail (e.g. the new address) instead of a secret.
  NOTICE_TEMPLATES = %w[admin_email_changed account_email_changed account_password_set account_password_removed].freeze

  queue_as :mailers

  retry_on Faraday::ConnectionFailed, Faraday::TimeoutError, Faraday::SSLError, ProviderUnavailable,
    wait: :polynomially_longer, attempts: 5

  def self.enqueue(user:, template:, link:)
    perform_later(user.id, template, seal(link))
  end

  # Sends a sign-in code to an existing user (user:) or to a not-yet-created
  # account's address (email:). Codes expire quickly, so the seal does too.
  def self.enqueue_code(template:, code:, user: nil, email: nil)
    raise ArgumentError, "user or email required" if user.nil? && email.blank?
    sealed_email = user ? nil : seal(email, purpose: RECIPIENT_PURPOSE, expires_in: SignInCode::LIFETIME)
    perform_later(user&.id, template, seal(code, expires_in: SignInCode::LIFETIME), sealed_email)
  end

  # Sends a notice to an address given explicitly (the user's row may no longer hold it,
  # e.g. the previous address after an email change). Nothing in it is a secret, but the
  # address is sealed like every other recipient so the job row holds no email address.
  def self.enqueue_notice(template:, detail:, email:)
    raise ArgumentError, "unknown notice template" unless NOTICE_TEMPLATES.include?(template)
    perform_later(nil, template, seal(detail.to_s), seal(email, purpose: RECIPIENT_PURPOSE))
  end

  # Sends a link email to an explicit address (no account required yet), with an extra
  # display value (e.g. the voucher's name for "vouch_invite") merged into the template data.
  def self.enqueue_link_with_name(template:, link:, email:, name:)
    perform_later(nil, template, seal(link), seal(email, purpose: RECIPIENT_PURPOSE), seal(name, purpose: NAME_PURPOSE))
  end

  def self.seal(value, purpose: LINK_PURPOSE, expires_in: 1.day) = encryptor.encrypt_and_sign(value, purpose:, expires_in:)

  def self.unseal(sealed, purpose: LINK_PURPOSE) = encryptor.decrypt_and_verify(sealed, purpose:)

  def self.encryptor
    ActiveSupport::MessageEncryptor.new(Rails.application.key_generator.generate_key("email-delivery-job-link", 32))
  end

  def perform(user_id, template, sealed_link, sealed_email = nil, sealed_name = nil)
    to = recipient_for(user_id, sealed_email)
    return log_skip("recipient_missing", template) if to.blank?
    return log_skip("recipient_synthetic", template) if user_id.present? && User.where(id: user_id).where.not(synthetic_batch: nil).exists?

    secret = self.class.unseal(sealed_link)
    return log_skip("link_unreadable", template) unless secret

    data = if CODE_TEMPLATES.include?(template) then { code: secret }
    elsif NOTICE_TEMPLATES.include?(template) then { detail: secret }
    else { link: secret }
    end
    data[:name] = self.class.unseal(sealed_name, purpose: NAME_PURPOSE) if sealed_name.present?
    result = EmailDelivery.call(to:, template:, data:, raise_errors: true)
    raise ProviderUnavailable, "email provider returned #{result[:status]}" if result[:status].to_i >= 500

    log_skip(result[:reason] || "rejected_#{result[:status]}", template) unless result[:delivered]
  rescue ActiveSupport::MessageEncryptor::InvalidMessage
    log_skip("link_unreadable", template)
  end

  private

  def recipient_for(user_id, sealed_email)
    return User.find_by(id: user_id)&.email if user_id.present?
    self.class.unseal(sealed_email, purpose: RECIPIENT_PURPOSE) if sealed_email.present?
  end

  def log_skip(reason, template)
    Rails.logger.warn({ event: "email_delivery_skipped", jobId: job_id, template:, reason: }.to_json)
  end
end
