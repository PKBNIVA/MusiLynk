# "Email me when payments open" (Profile#payments_notify?): the one email that preference
# promises. An admin sends it once Razorpay is usable (Admin::PaymentsOpenEmailsController).
#
# Each opted-in member gets exactly one email: the preference is cleared in the same
# transaction that enqueues the email, under a row lock, so a second click (or a second
# worker) finds nothing left to send. People who cannot be emailed right now (unverified or
# suppressed address, reserved test address, turned notification emails off) are skipped and
# keep their preference. Synthetic (demo) accounts are never counted or emailed.
class PaymentsOpenEmails
  TEMPLATE = "payments_open".freeze

  Result = Struct.new(:sent, :skipped, keyword_init: true)

  # Everyone currently waiting: real, active members with the preference on.
  def self.waiting_users
    User.organic.where(status: "active").joins(:profile)
      .where("profiles.email_preferences ->> ? = 'true'", Profile::PAYMENTS_NOTIFY_KEY)
      .includes(:profile)
  end

  def self.waiting = waiting_users.count

  # How many of those can be emailed right now.
  def self.sendable = waiting_users.find_each.count { NotificationEmail.deliverable_to?(_1) }

  def self.call
    return Result.new(sent: 0, skipped: 0) unless RazorpayConfig.usable?

    sent = skipped = 0
    waiting_users.find_each do |user|
      deliver(user) ? sent += 1 : skipped += 1
    end
    Result.new(sent:, skipped:)
  end

  def self.deliver(user)
    Profile.transaction do
      profile = Profile.lock.find_by(user_id: user.id)
      return false unless profile&.payments_notify? && NotificationEmail.deliverable_to?(user)

      profile.update!(email_preferences: profile.email_preferences.to_h.merge(Profile::PAYMENTS_NOTIFY_KEY => false))
      NotificationEmailJob.perform_later(user.id, TEMPLATE, { "path" => "#{FrontendUrl.base}/pricing" })
    end
    true
  end
  private_class_method :deliver
end
