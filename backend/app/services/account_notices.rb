# Security notices sent to the person an account belongs to. Never raises: the action that
# triggered the notice has already happened and must not fail because mail could not be queued.
module AccountNotices
  module_function

  # The password set before the mailbox was proven was removed (User#reclaim_unverified_credentials!).
  def password_removed(user)
    deliver(user, "account_password_removed")
  end

  def deliver(user, template)
    return unless EmailDelivery.configured?
    return if EmailDelivery.reserved_address?(user.email) || EmailSuppression.blocks_all?(user.email)

    EmailDeliveryJob.enqueue_notice(template:, detail: user.email, email: user.email)
  rescue StandardError => error
    Rails.logger.error({ event: "email_enqueue_failed", template:, error: error.class.name }.to_json)
    ErrorReporter.capture(error, tags: { source: "email_enqueue_failed", template: })
  end
end
