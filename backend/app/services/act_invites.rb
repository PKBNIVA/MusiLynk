# Creating, delivering, answering and revoking bandmate invites (ActInvite). The one place that
# knows the rules, so ActsController#add_member and ActInvitesController behave identically.
# Raises ActInvites::Refused with the HTTP status and code the API should answer with.
module ActInvites
  class Refused < StandardError
    attr_reader :status, :code, :fields

    def initialize(message, status, code = nil, fields: nil)
      super(message)
      @status = status
      @code = code
      @fields = fields
    end
  end

  GONE = {
    "accepted" => ["This invite has already been used.", "INVITE_USED"],
    "declined" => ["This invite was declined.", "INVITE_DECLINED"],
    "revoked" => ["This invite was cancelled by the band.", "INVITE_REVOKED"],
    "expired" => ["This invite has expired. Ask the band to send a new one.", "INVITE_EXPIRED"]
  }.freeze

  module_function

  def link_for(token) = "#{FrontendUrl.base}/invites/#{token}"

  # Returns [invite, raw_token]. `invitee` is a User for kind "user"; `email` a String for kind "email".
  def create!(act:, inviter:, kind:, role_name:, instrument: nil, invitee: nil, email: nil)
    raise Refused.new("Choose how to invite: a MusiLynk musician, an email address or a link.", :unprocessable_content, "VALIDATION_FAILED") unless ActInvite::KINDS.include?(kind)
    if kind == "email" && !inviter.email_verified?
      raise Refused.new("Verify your email address before inviting people by email.", :forbidden, "EMAIL_NOT_VERIFIED")
    end
    enforce_creation_limits!(act, inviter)
    invite = ActInvite.new(act:, inviter:, kind:, role_name:, instrument:, status: "pending", expires_at: ActInvite::LIFETIME.from_now)
    case kind
    when "user"
      invite.invitee_user = invitee
    when "email"
      invite.invitee_email = email
    end
    token = invite.rotate_token!
    unless invite.valid?
      raise Refused.new(invite.errors.full_messages.to_sentence, :unprocessable_content, "VALIDATION_FAILED", fields: invite.errors.to_hash(true).transform_keys { _1 == :role_name ? "roleName" : _1.to_s.camelize(:lower) })
    end
    reject_duplicate!(invite)
    enforce_recipient_limit!(invite)
    invite.save!
    deliver!(invite, token)
    [invite, token]
  end

  def enforce_creation_limits!(act, inviter)
    since = 24.hours.ago
    too_many = ActInvite.where(act_id: act.id).where(created_at: since..).count >= ActInvite::MAX_PER_ACT_PER_DAY ||
      ActInvite.where(inviter_id: inviter.id).where(created_at: since..).count >= ActInvite::MAX_PER_INVITER_PER_DAY
    raise Refused.new("You've sent a lot of invites today. Try again tomorrow.", :too_many_requests, "RATE_LIMITED") if too_many
    return if ActInvite.live.where(act_id: act.id).count < ActInvite::MAX_PENDING_PER_ACT
    raise Refused.new("This act has too many pending invites. Cancel some before sending more.", :too_many_requests, "RATE_LIMITED")
  end

  # One person can't be flooded by many acts or inviters: at most MAX_PER_RECIPIENT_PER_DAY invites a day.
  def enforce_recipient_limit!(invite)
    scope = case invite.kind
            when "user" then ActInvite.where(invitee_user_id: invite.invitee_user_id)
            when "email" then ActInvite.where(invitee_email: invite.invitee_email)
            end
    return unless scope
    return if scope.where(created_at: 24.hours.ago..).count < ActInvite::MAX_PER_RECIPIENT_PER_DAY

    raise Refused.new("That person has already received several invites today. Try again tomorrow.", :too_many_requests, "RATE_LIMITED")
  end

  def reject_duplicate!(invite)
    act = invite.act
    clash = "That person is already in this lineup or has a pending invite."
    case invite.kind
    when "user"
      raise Refused.new(clash, :conflict, "ALREADY_INVITED") if act.act_members.exists?(user_id: invite.invitee_user_id) || ActInvite.live.exists?(act_id: act.id, invitee_user_id: invite.invitee_user_id)
    when "email"
      member_by_email = User.where(email: invite.invitee_email).pick(:id)
      raise Refused.new(clash, :conflict, "ALREADY_INVITED") if (member_by_email && act.act_members.exists?(user_id: member_by_email)) || ActInvite.live.exists?(act_id: act.id, invitee_email: invite.invitee_email)
    end
  end

  # An existing, deliverable MusiLynk musician hears in the app and by notification email (no token in the job
  # row); anyone else gets the sealed link email.
  def deliver!(invite, token)
    return if invite.kind == "link"
    user = recipient_user(invite)
    if user && NotificationEmail.deliverable_to?(user)
      Notifier.act_invite(invite, user)
    elsif invite.kind == "email"
      Notifier.act_invite_email(invite, link: link_for(token))
      Notifier.act_invite(invite, user, email: false) if user
    elsif user
      Notifier.act_invite(invite, user, email: false)
    end
    invite.update_columns(last_sent_at: Time.current, send_count: invite.send_count + 1)
  end

  def recipient_user(invite)
    return invite.invitee_user if invite.kind == "user"
    user = User.find_by(email: invite.invitee_email)
    user if user&.jobseeker? && user.active? && user.email_verified?
  end

  # Re-sends an email or user invite: a new secret, a fresh seven days; the old link stops working.
  def resend!(invite)
    raise Refused.new("A shared link can't be re-sent. Cancel it and make a new one.", :unprocessable_content, "NOT_RESENDABLE") if invite.kind == "link"
    raise_gone!(invite) unless invite.open?
    if invite.last_sent_at && invite.last_sent_at > ActInvite::RESEND_GAP.ago
      raise Refused.new("You just sent this. Wait a couple of minutes before sending it again.", :too_many_requests, "RATE_LIMITED")
    end
    raise Refused.new("This invite has been sent several times already. Cancel it and invite again if needed.", :too_many_requests, "RATE_LIMITED") if invite.send_count >= ActInvite::MAX_SENDS
    token = invite.rotate_token!
    invite.expires_at = ActInvite::LIFETIME.from_now
    invite.save!
    deliver!(invite, token)
    invite
  end

  def revoke!(invite)
    raise_gone!(invite) unless invite.open?
    invite.update!(status: "revoked", responded_at: Time.current)
    invite
  end

  # The invitee says yes. Locks the row so a link is single-use even under concurrent taps.
  def accept!(invite, user)
    raise Refused.new("Only musician accounts can join a lineup.", :forbidden, "NOT_A_MUSICIAN") unless user.jobseeker?
    member = nil
    invite.with_lock do
      raise_gone!(invite) unless invite.open?
      raise Refused.new("This invite was sent to someone else. Sign in with the account it was sent to.", :forbidden, "INVITE_NOT_FOR_YOU") unless invite.addressed_to?(user)
      act = invite.act
      raise Refused.new("This act is no longer taking members.", :gone, "INVITE_EXPIRED") if act.status == "hidden"
      raise Refused.new("You're already in this lineup.", :conflict, "ALREADY_MEMBER") if act.act_members.exists?(user_id: user.id)
      member = act.act_members.create!(user:, display_name: user.name, role_name: invite.role_name, instrument: invite.instrument, member_status: "confirmed", is_leader: false)
      invite.update!(status: "accepted", responded_at: Time.current, accepted_by_id: user.id)
    end
    Notifier.act_invite_response(invite, user, accepted: true)
    member
  end

  def decline!(invite, user)
    invite.with_lock do
      raise_gone!(invite) unless invite.open?
      raise Refused.new("This invite was sent to someone else.", :forbidden, "INVITE_NOT_FOR_YOU") unless invite.addressed_to?(user)
      # A shared link is not addressed to anyone, so one person turning it down must not burn it for the rest.
      next if invite.kind == "link"
      invite.update!(status: "declined", responded_at: Time.current)
    end
    Notifier.act_invite_response(invite, user, accepted: false) unless invite.kind == "link"
    invite
  end

  def raise_gone!(invite)
    message, code = GONE.fetch(invite.state)
    raise Refused.new(message, :gone, code)
  end
end
