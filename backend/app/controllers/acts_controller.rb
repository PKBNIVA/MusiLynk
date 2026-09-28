class ActsController < ApplicationController
  include ListPaging
  LIST_PARAMS = %i[q city type genre eventType limit cursor].freeze
  LIST_ORDER = ["acts.verified DESC", "acts.updated_at DESC", "acts.id ASC"].freeze
  CITY_FIELDS = Search::Query::Fields.new(primary: [], secondary: [], tertiary: [], location: ["acts.city"])
  # Only "confirmed" exists today: public lineups show confirmed members and no flow sets another status.
  MEMBER_STATUSES = %w[confirmed].freeze

  def public_index = render_listing
  def public_show = render(json: { act: public_visible(Act.includes(:act_members, owner: :profile).where(status: "active")).find(params[:id]).public_json })

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
    render json: { acts: current_user.owned_acts.includes(:act_members, owner: :profile).order(updated_at: :desc).limit(200).map(&:api_json) }
  end

  def create
    return unless authenticate!("jobseeker", "employer")
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
    linked_user = nil
    if params[:userId].present?
      # Only active professionals can be linked to a lineup; anything else is indistinguishable from unknown.
      linked_user = User.jobseeker.active.find_by(id: params[:userId].to_s)
      return render_error("Professional not found.", :not_found) unless linked_user
      return render_error("That professional is already in this lineup.", :conflict) if act.act_members.exists?(user_id: linked_user.id)
    end
    member = act.act_members.create!(display_name: params[:displayName], role_name: params[:roleName], instrument: params[:instrument], member_status: status, is_leader: false, user: linked_user)
    render json: { id: member.id }, status: :created
  end

  def update
    return unless authenticate!("jobseeker", "employer")
    act = current_user.owned_acts.find(params[:id])
    act.update!(act_params)
    audit!("act.update", act)
    render json: { act: act.reload.api_json }
  end

  def destroy
    return unless authenticate!("jobseeker", "employer")
    act = current_user.owned_acts.find(params[:id])
    act.update!(status: "inactive")
    audit!("act.deactivate", act)
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

  # One ranked page of active acts. Filters: q (name, type, genres, events, lineup roles and
  # instruments), city, type (act type), genre and eventType; paged like the talent directory.
  def render_listing
    unless LIST_PARAMS.all? { params[_1].nil? || params[_1].is_a?(String) }
      return render_error("Search filters must be plain text.", :bad_request, "INVALID_PARAMETER")
    end
    offset = list_offset
    return render_invalid_cursor if offset.nil?
    scope = public_visible(Act.includes(:act_members, owner: :profile).where(status: "active"))
    scope = Search::Query.new(params[:city]).filter(scope, CITY_FIELDS)
    scope = scope.where("acts.act_type ILIKE ?", ActiveRecord::Base.sanitize_sql_like(params[:type].to_s.strip)) if params[:type].present?
    scope = scope.where("acts.genres::text ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(params[:genre].to_s.strip)}%") if params[:genre].present?
    scope = scope.where("acts.event_types::text ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(params[:eventType].to_s.strip)}%") if params[:eventType].present?
    limit = list_limit
    search = Search::Runner.call(scope, params[:q], Search::Targets::ACTS, order: LIST_ORDER, offset:, limit:)
    render json: { acts: search.rows.map(&:public_json), nextCursor: list_next_cursor(search, offset, limit), total: search.total }.merge(search.meta)
  end

  # Same rule as talent: non-demo synthetic QA batches are only visible to synthetic viewers.
  def public_visible(scope) = current_user&.synthetic_batch.present? ? scope : SyntheticQa::Demo.publicly_listed(scope.joins(:owner))

  def act_params
    raw = params.permit(:name, :actType, :tagline, :bio, :city, :lineupSize, :minFee, :maxFee, :currency, :feeBasis, :travelRadiusKm, :travelsNationally, :travelsInternationally, :techRiderUrl, :hospitalityRiderUrl, :promoUrl, :status, genres: [], languages: [], eventTypes: []).to_h.transform_keys { _1.underscore }
    raw["currency"] ||= "INR"; raw["fee_basis"] ||= "event"; raw["status"] ||= "active"; raw
  end
end
