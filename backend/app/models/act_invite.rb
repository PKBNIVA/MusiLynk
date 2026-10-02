# An invitation to join an act's lineup. Nobody becomes a member until they accept (consent).
#
# kind "user":  addressed to one MusiLynk musician (invitee_user_id).
# kind "email": addressed to an email address; whoever signs in with that verified address may accept.
# kind "link":  a shareable link for one lineup slot; any signed-in musician may accept it, once.
#
# The secret token is shown once (in the link) and only its HMAC digest is stored.
class ActInvite < ApplicationRecord
  KINDS = %w[user email link].freeze
  STATUSES = %w[pending accepted declined revoked].freeze
  LIFETIME = 7.days
  # Creation limits (rows created in the window, whatever their status).
  MAX_PER_ACT_PER_DAY = 20
  MAX_PER_INVITER_PER_DAY = 30
  MAX_PENDING_PER_ACT = 25
  # Per recipient (same email address or same MusiLynk user), across every act and inviter.
  MAX_PER_RECIPIENT_PER_DAY = 3
  # Resend limits for one invite.
  RESEND_GAP = 2.minutes
  MAX_SENDS = 5

  belongs_to :act
  belongs_to :inviter, class_name: "User"
  belongs_to :invitee_user, class_name: "User", optional: true

  normalizes :invitee_email, with: ->(value) { value.to_s.strip.downcase.presence }
  normalizes :role_name, :instrument, with: ->(value) { value.to_s.squish.presence }

  validates :kind, inclusion: { in: KINDS }
  validates :status, inclusion: { in: STATUSES }
  validates :role_name, presence: { message: "Add the role this person will play." }, length: { maximum: 80 }
  validates :instrument, length: { maximum: 80 }, allow_nil: true
  validates :invitee_user_id, presence: true, if: -> { kind == "user" }
  validates :invitee_email, presence: { message: "Enter an email address." }, if: -> { kind == "email" }
  validates :invitee_email, format: { with: URI::MailTo::EMAIL_REGEXP, message: "Enter a valid email address." }, length: { maximum: 254 }, allow_nil: true
  validates :token_digest, presence: true, uniqueness: true

  scope :live, -> { where(status: "pending").where("expires_at > ?", Time.current) }

  def self.digest(token) = OpenSSL::HMAC.hexdigest("SHA256", Rails.application.key_generator.generate_key("act-invite-token", 32), token.to_s)

  def self.generate_token = SecureRandom.urlsafe_base64(32)

  def self.find_by_token(token)
    token = token.to_s
    return nil if token.blank? || token.length > 200
    find_by(token_digest: digest(token))
  end

  # Invites a musician can see and answer: sent to them by id, or to their verified email.
  def self.addressed_to(user)
    scope = where(kind: "user", invitee_user_id: user.id)
    scope = scope.or(where(kind: "email", invitee_email: user.email)) if user.email_verified? && user.email.present?
    scope
  end

  # Starts a new secret: returns the raw token (shown once) after storing its digest.
  def rotate_token!
    raw = self.class.generate_token
    self.token_digest = self.class.digest(raw)
    raw
  end

  def expired? = status == "pending" && expires_at <= Time.current
  def open? = status == "pending" && expires_at > Time.current

  # "pending", "accepted", "declined", "revoked" or "expired".
  def state = expired? ? "expired" : status

  def addressed_to?(user)
    case kind
    when "user" then invitee_user_id == user.id
    when "email" then user.email_verified? && invitee_email.present? && user.email.to_s.casecmp?(invitee_email)
    else true
    end
  end

  # Sent to the owner: no token, no email address (only a masked hint of who it was for).
  def owner_json
    {
      id:, actId: act_id, kind:, status: state, roleName: role_name, instrument:,
      inviteeName: invitee_user&.name, inviteeEmail: masked_email,
      expiresAt: expires_at.iso8601, createdAt: created_at.iso8601, lastSentAt: last_sent_at&.iso8601,
      canResend: kind != "link" && open?
    }
  end

  # Sent to the invitee.
  def invitee_json
    {
      id:, actId: act_id, actName: act.name, actType: act.act_type, city: act.city, inviterName: inviter.name,
      roleName: role_name, instrument:, status: state, expiresAt: expires_at.iso8601, createdAt: created_at.iso8601
    }
  end

  def masked_email
    return nil if invitee_email.blank?
    local, domain = invitee_email.split("@", 2)
    "#{local.first(1)}***@#{domain}"
  end
end
