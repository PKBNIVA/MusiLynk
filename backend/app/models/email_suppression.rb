# One row per address the email provider reported a delivery problem for.
#
# scope "all"           hard bounce, spam complaint or provider block: no email at all,
#                       including sign-in codes (they would never arrive anyway).
# scope "notifications" the recipient unsubscribed at the provider: notification emails
#                       stop, security emails (sign-in codes, resets) still go.
# scope "none"          soft bounces (mailbox full, greylisting): recorded so admins can
#                       see them, but delivery continues.
#
# A later, weaker event never lifts a stronger suppression (a soft bounce after a hard
# bounce keeps the address suppressed), and replaying the same provider event is a no-op.
class EmailSuppression < ApplicationRecord
  SCOPES = %w[none notifications all].freeze

  # Provider event name -> [reason, scope]. Brevo names both "spam" and "complaint".
  BREVO_EVENTS = {
    "hard_bounce" => %w[hard_bounce all], "hardBounce" => %w[hard_bounce all],
    "invalid_email" => %w[hard_bounce all], "invalid" => %w[hard_bounce all],
    "spam" => %w[complaint all], "complaint" => %w[complaint all],
    "blocked" => %w[blocked all],
    "unsubscribed" => %w[unsubscribed notifications], "unsubscribe" => %w[unsubscribed notifications],
    "soft_bounce" => %w[soft_bounce none], "softBounce" => %w[soft_bounce none]
  }.freeze

  validates :email, presence: true
  validates :scope, inclusion: { in: SCOPES }

  before_validation { self.email = self.class.normalize(email) }

  scope :suppressed, -> { where(scope: %w[all notifications]) }

  def self.normalize(email) = email.to_s.strip.downcase

  # True when no email of any kind should be sent to this address.
  def self.blocks_all?(email)
    address = normalize(email)
    address.present? && where(email: address, scope: "all").exists?
  end

  # True when notification emails should not be sent to this address.
  def self.blocks_notifications?(email)
    address = normalize(email)
    address.present? && suppressed.where(email: address).exists?
  end

  # Records a provider event. Returns :recorded, :duplicate or :ignored (an event type that
  # says nothing about deliverability, such as "delivered" or "opened").
  def self.record!(email:, event:, message_id: nil, at: Time.current, provider: "brevo")
    reason, scope = BREVO_EVENTS[event.to_s]
    address = normalize(email)
    return :ignored unless reason && address.match?(URI::MailTo::EMAIL_REGEXP)

    transaction(requires_new: true) do
      row = lock.find_by(email: address)
      return :duplicate if row && message_id.present? && row.last_message_id == message_id && row.last_event == event.to_s

      row ||= new(email: address, reason:, scope:, provider:)
      row.soft_bounce_count += 1 if reason == "soft_bounce"
      if SCOPES.index(scope) >= SCOPES.index(row.scope)
        row.scope = scope
        row.reason = reason
      end
      row.suppressed_at ||= at if row.scope != "none"
      row.assign_attributes(last_event: event.to_s, last_message_id: message_id.presence, last_event_at: at, provider:)
      row.save!
    end
    :recorded
  rescue ActiveRecord::RecordNotUnique
    # A concurrent delivery of an event for the same address created the row first; apply this one on top.
    retry
  end

  # Counts for the admin health view: { total:, all:, notificationsOnly:, softBounces:, byReason: {} }.
  def self.summary
    counts = group(:scope).count
    {
      total: counts.fetch("all", 0) + counts.fetch("notifications", 0),
      all: counts.fetch("all", 0),
      notificationsOnly: counts.fetch("notifications", 0),
      softBounces: counts.fetch("none", 0),
      byReason: suppressed.group(:reason).count
    }
  end
end
