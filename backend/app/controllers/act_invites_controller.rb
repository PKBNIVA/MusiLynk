# Bandmate invites. Owners create, list, resend and revoke them (nested under /api/acts/:id);
# musicians see and answer the ones sent to them, or follow a link (/api/act-invites/...).
# Joining a lineup always needs the musician's own accept (ActInvites).
class ActInvitesController < ApplicationController
  include ScalarParams
  include UserRateLimit

  SEARCH_PER_HOUR = RateLimits.limit("act-invite-search")
  RESEND_PER_HOUR = RateLimits.limit("act-invite-resend")
  TOKEN_ATTEMPTS = RateLimits.limit("act-invite-token")
  rescue_from ActInvites::Refused do |error|
    render_error(error.message, error.status, error.code, fields: error.fields)
  end

  before_action -> { authenticate!("jobseeker", "employer") }, only: %i[search index create resend revoke]
  before_action -> { authenticate!("jobseeker") }, only: :mine

  # Musicians the owner can invite: name and public profile details only, never an email address.
  def search
    act = owned_act
    return unless require_scalar_params!(:q)
    return unless within_user_rate_limit?("act-invite-search")
    query = params[:q].to_s.squish
    return render json: { musicians: [] } if query.length < 2

    taken = act.act_members.where.not(user_id: nil).select(:user_id)
    scope = SyntheticQa::Demo.publicly_listed(User.jobseeker.active.joins(:profile))
      .where.not(id: current_user.id).where.not(id: taken)
      .where.not(id: UserBlock.where(blocker_id: current_user.id).select(:blocked_id))
      .where.not(id: UserBlock.where(blocked_id: current_user.id).select(:blocker_id))
    like = "%#{ActiveRecord::Base.sanitize_sql_like(query)}%"
    scope = scope.where("users.name ILIKE :q OR profiles.headline ILIKE :q OR profiles.location ILIKE :q OR profiles.roles::text ILIKE :q", q: like)
    rows = scope.includes(:profile).order(Arel.sql("profiles.verified DESC"), :name, :id).limit(8)
    render json: { musicians: rows.map { |u| { id: u.id, name: u.name, headline: u.profile&.headline, location: u.profile&.location, roles: Array(u.profile&.roles).first(3), verified: u.profile&.verified || false } } }
  end

  def index
    act = owned_act
    invites = act.act_invites.includes(:invitee_user).order(created_at: :desc).limit(50)
    render json: { invites: invites.map(&:owner_json) }
  end

  def create
    act = owned_act
    return unless require_scalar_params!(:kind, :userId, :email, :roleName, :instrument)
    kind = params[:kind].to_s.presence || (params[:userId].present? ? "user" : params[:email].present? ? "email" : "link")
    invitee = nil
    if kind == "user"
      invitee = invitable_musician(params[:userId])
      return render_error("Musician not found.", :not_found) unless invitee
    end
    invite, token = ActInvites.create!(act:, inviter: current_user, kind:, role_name: params[:roleName], instrument: params[:instrument],
      invitee:, email: params[:email])
    audit!("act_invite.create", invite, { actId: act.id, kind: })
    body = { invite: invite.owner_json }
    body[:link] = ActInvites.link_for(token) if kind == "link"
    render json: body, status: :created
  end

  def resend
    return unless within_user_rate_limit?("act-invite-resend")
    invite = ActInvites.resend!(owned_invite)
    audit!("act_invite.resend", invite, { actId: invite.act_id })
    render json: { invite: invite.owner_json }
  end

  def revoke
    invite = ActInvites.revoke!(owned_invite)
    audit!("act_invite.revoke", invite, { actId: invite.act_id })
    render json: { invite: invite.owner_json }
  end

  # Pending invites addressed to the signed-in musician.
  def mine
    invites = ActInvite.addressed_to(current_user).live.includes(:act, :inviter).order(created_at: :desc).limit(50)
    render json: { invites: invites.map(&:invitee_json) }
  end

  # What a link visitor sees before signing in: the band, who invited them and the role. No emails.
  def preview
    return unless require_scalar_params!(:token)
    return unless throttle!("act-invite-token")
    invite = ActInvite.find_by_token(params[:token])
    return render_error("This invite link isn't valid. Ask the band to send a new one.", :not_found, "INVITE_NOT_FOUND") unless invite
    render json: { invite: invite.invitee_json.merge(addressed: invite.kind != "link") }
  end

  def accept
    invite = answerable_invite or return
    member = ActInvites.accept!(invite, current_user)
    audit!("act_invite.accept", invite, { actId: invite.act_id, kind: invite.kind })
    render json: { invite: invite.reload.invitee_json, member: member.api_json }
  end

  def decline
    invite = answerable_invite or return
    ActInvites.decline!(invite, current_user)
    audit!("act_invite.decline", invite, { actId: invite.act_id, kind: invite.kind }) unless invite.kind == "link"
    render json: { invite: invite.reload.invitee_json }
  end

  private

  def owned_act = current_user.owned_acts.where.not(id: Act.direct_enquiry.select(:id)).find(params[:id])

  def owned_invite = owned_act.act_invites.find(params[:invite_id])

  def invitable_musician(id)
    user = User.jobseeker.active.find_by(id: id.to_s)
    return nil if user.nil? || user.id == current_user.id || UserBlock.between?(current_user, user)
    user
  end

  # By token (anyone signed in; the invite itself decides who may accept) or, for a musician's own
  # list, by id (only invites addressed to them). Unknown or someone else's: the same 404.
  def answerable_invite
    return nil unless authenticate!
    return nil unless require_scalar_params!(:token, :id)
    if params[:id].present?
      invite = ActInvite.addressed_to(current_user).find_by(id: params[:id].to_s)
    else
      return nil unless throttle!("act-invite-token")
      invite = ActInvite.find_by_token(params[:token])
    end
    render_error("This invite link isn't valid. Ask the band to send a new one.", :not_found, "INVITE_NOT_FOUND") unless invite
    invite
  end
end
