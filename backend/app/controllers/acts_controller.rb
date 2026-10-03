class ActsController < ApplicationController
  include ListPaging
  LIST_PARAMS = %i[q city type genre eventType member limit cursor].freeze
  LIST_ORDER = ["acts.verified DESC", "acts.updated_at DESC", "acts.id ASC"].freeze
  # Only "confirmed" exists today: public lineups show confirmed members and no flow sets another status.
  MEMBER_STATUSES = %w[confirmed].freeze

  def public_index = render_listing(cache: :listing)

  def public_show
    json = { act: public_visible(Act.includes(:act_members, owner: :profile).where(status: "active")).find(params[:id]).public_json }.to_json
    return if public_cache!(:show, etag: json)
    render json: json
  end

  def index
    return unless authenticate!
    render_listing
  end

  def show
    return unless authenticate!
    scope = Act.includes(:act_members, owner: :profile)
    scope = scope.where("acts.status = ? OR acts.owner_id = ?", "active", current_user.id) unless current_user.admin?
    act = scope.find(params[:id])
    render json: { act: act.owner_id == current_user.id || current_user.admin? ? act.api_json : act.public_json }
  end

  def mine
    return unless authenticate!("jobseeker", "employer")
    render json: { acts: current_user.owned_acts.where.not(id: Act.direct_enquiry.select(:id)).includes(:act_members, owner: :profile).order(updated_at: :desc).limit(200).map(&:api_json), memberships: memberships }
  end

  def create
    return unless authenticate!("jobseeker", "employer")
    return unless photo_allowed?(nil)
    act = current_user.owned_acts.create!(act_params)
    act.act_members.create!(display_name: current_user.name, role_name: params[:leaderRole].presence || params[:ownerRole].presence || "Leader", is_leader: true, member_status: "confirmed", user: current_user)
    audit!("act.create", act)
    render json: { id: act.id, act: act.reload.api_json }, status: :created
  end

  def add_member
    return unless authenticate!("jobseeker", "employer")
    act = current_user.owned_acts.find(params[:id])
    status = params[:memberStatus].presence || "confirmed"
    return render_error("Invalid member status.", :bad_request, "INVALID_MEMBER_STATUS") unless MEMBER_STATUSES.include?(status)
    if params[:userId].present?
      # Joining a lineup needs the musician's own say-so: this sends an invite instead of adding them.
      # Only active professionals can be invited; anything else is indistinguishable from unknown.
      linked_user = User.jobseeker.active.find_by(id: params[:userId].to_s)
      return render_error("Musician not found.", :not_found) if linked_user.nil? || linked_user.id == current_user.id || UserBlock.between?(current_user, linked_user)
      begin
        invite, = ActInvites.create!(act:, inviter: current_user, kind: "user", invitee: linked_user, role_name: params[:roleName], instrument: params[:instrument])
      rescue ActInvites::Refused => error
        return render_error(error.message, error.status, error.code, fields: error.fields)
      end
      audit!("act_invite.create", invite, { actId: act.id, kind: "user" })
      return render json: { id: invite.id, invited: true, invite: invite.owner_json }, status: :created
    end
    member = act.act_members.create!(display_name: params[:displayName], role_name: params[:roleName], instrument: params[:instrument], member_status: status, is_leader: false, user: nil)
    render json: { id: member.id }, status: :created
  end

  def update
    return unless authenticate!("jobseeker", "employer")
    act = current_user.owned_acts.find(params[:id])
    return unless photo_allowed?(act)
    attributes = act_params
    # Hidden acts (moderated, or the direct-enquiry act) stay hidden; an update never re-lists them.
    attributes.delete("status") if act.status == "hidden"
    act.update!(attributes)
    audit!("act.update", act)
    render json: { act: act.reload.api_json }
  end

  def destroy
    return unless authenticate!("jobseeker", "employer")
    act = current_user.owned_acts.find(params[:id])
    act.update!(status: "inactive") unless act.status == "hidden"
    audit!("act.deactivate", act)
    render json: { ok: true }
  end

  # A member leaves the lineup themselves. The leader (the owner) cannot; they would delete or hand over the act.
  def leave
    return unless authenticate!("jobseeker", "employer")
    act = Act.find(params[:id])
    member = act.act_members.find_by(user_id: current_user.id)
    return render_error("You're not in this lineup.", :not_found) unless member
    return render_error("The act leader cannot leave their own act.", :conflict) if member.is_leader?
    member.destroy!
    audit!("act.member_leave", act)
    render json: { ok: true }
  end

  def remove_member
    return unless authenticate!("jobseeker", "employer")
    act = current_user.owned_acts.find(params[:id])
    member = act.act_members.find(params[:member_id])
    return render_error("The act leader cannot be removed.", :conflict) if member.is_leader?
    member.destroy!
    render json: { ok: true }
  end

  private

  # Lineups the signed-in musician plays in but does not own, so they can leave.
  def memberships
    ActMember.includes(:act).where(user_id: current_user.id, is_leader: false).where.not(acts: { owner_id: current_user.id }).references(:act)
      .where.not(acts: { status: "hidden" }).limit(100).map { { actId: _1.act_id, actName: _1.act.name, roleName: _1.role_name, instrument: _1.instrument } }
  end

  # One ranked page of active acts. Filters: q (name, type, genres, events, lineup roles and
  # instruments), city, type (act type), genre, eventType and member (a musician's id); paged like the talent directory.
  # `cache` names the edge-cache lifetime (PublicCaching) for the anonymous public listing.
  def render_listing(cache: nil)
    unless LIST_PARAMS.all? { params[_1].nil? || params[_1].is_a?(String) }
      return render_error("Search filters must be plain text.", :bad_request, "INVALID_PARAMETER")
    end
    offset = list_offset
    return render_invalid_cursor if offset.nil?
    scope = public_visible(Act.includes(:act_members, owner: :profile).where(status: "active"))
    scope = Search::Query.new(params[:city]).as_location.filter(scope, Search::Targets::ACTS)
    scope = scope.where("acts.act_type ILIKE ?", ActiveRecord::Base.sanitize_sql_like(params[:type].to_s.strip)) if params[:type].present?
    scope = scope.where("acts.genres::text ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(params[:genre].to_s.strip)}%") if params[:genre].present?
    scope = scope.where("acts.event_types::text ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(params[:eventType].to_s.strip)}%") if params[:eventType].present?
    scope = fronted_by(scope, params[:member].to_s.strip) if params[:member].present?
    limit = list_limit
    search = Search::Runner.call(scope, params[:q], Search::Targets::ACTS, order: LIST_ORDER, offset:, limit:)
    json = { acts: search.rows.map(&:public_json), nextCursor: list_next_cursor(search, offset, limit), total: search.total }.merge(search.meta).to_json
    return if cache && public_cache!(cache, etag: json)
    render json: json
  end

  # Acts a musician owns or plays in as a confirmed member (a profile's "Request a quote" lands on these).
  def fronted_by(scope, user_id)
    scope.where("acts.owner_id = :id OR EXISTS (SELECT 1 FROM act_members m WHERE m.act_id = acts.id AND m.user_id = :id AND m.member_status = 'confirmed')", id: user_id)
  end

  # Same rule as talent: non-demo synthetic QA batches are only visible to synthetic viewers.
  def public_visible(scope) = current_user&.synthetic_batch.present? ? scope : SyntheticQa::Demo.publicly_listed_acts(scope)

  # A photo must be an image the caller uploaded (or the one the act already has); anything else is refused.
  def photo_allowed?(act)
    photo = params[:photoUrl].to_s.strip
    return true if photo.blank? || photo == act&.photo_url || Upload.photo_owned_by?(current_user, photo)
    render_error("Upload a JPEG, PNG or WebP photo first, then save.", :unprocessable_content, "VALIDATION_FAILED", fields: { "photoUrl" => ["Upload a JPEG, PNG or WebP photo first, then save."] })
    false
  end

  def act_params
    raw = params.permit(:name, :actType, :tagline, :bio, :city, :lineupSize, :minFee, :maxFee, :currency, :feeBasis, :travelRadiusKm, :travelsNationally, :travelsInternationally, :techRiderUrl, :hospitalityRiderUrl, :promoUrl, :photoUrl, :status, genres: [], languages: [], eventTypes: []).to_h.transform_keys { _1.underscore }
    raw["photo_url"] = nil if raw.key?("photo_url") && raw["photo_url"].blank?
    # "hidden" is not the owner's to set.
    raw.delete("status") if raw["status"] == "hidden"
    raw["currency"] ||= "INR"; raw["fee_basis"] ||= "event"; raw["status"] ||= "active"; raw
  end
end
