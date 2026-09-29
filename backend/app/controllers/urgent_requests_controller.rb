class UrgentRequestsController < ApplicationController
  # The token-based one-click action from the expiry-warning email carries its own signed
  # authorization (UrgentActionToken) and is not necessarily hit by a signed-in session.
  before_action -> { authenticate!("jobseeker", "employer") }, except: :action_from_token
  LIST_LIMIT = 200

  def index
    return render_error("Filters must be plain text.", :bad_request, "INVALID_PARAMETER") unless [params[:city], params[:role]].all? { _1.nil? || _1.is_a?(String) }
    visible = UrgentRequest.open_and_recent.or(UrgentRequest.where(requester: current_user))
    scope = UrgentRequest.includes(:urgent_request_responses, :filled_by, requester: :profile).where(id: visible.select(:id)).order(start_at: :asc).limit(LIST_LIMIT)
    scope = scope.where("city ILIKE ?", "%#{ActiveRecord::Base.sanitize_sql_like(params[:city])}%") if params[:city].present?
    if params[:role].present?
      role = "%#{ActiveRecord::Base.sanitize_sql_like(params[:role])}%"
      scope = scope.where("role_name ILIKE :role OR instrument ILIKE :role OR title ILIKE :role", role:)
    end
    items = scope.to_a
    responded = UrgentRequestResponse.where(user: current_user, urgent_request_id: items.map(&:id)).pluck(:urgent_request_id).to_set
    reasons = UrgentRequestNotification.where(user: current_user, urgent_request_id: items.map(&:id), channel: "in_app")
      .pluck(:urgent_request_id, :reasons).to_h
    render json: { requests: items.map { |item| serialize(item, responded, reasons[item.id]) } }
  end

  # The confirmation/status screen for one request: how many musicians were notified and how
  # many responded so far. Only the requester can see it (their own live status card).
  def show
    item = UrgentRequest.where(requester: current_user).includes(:urgent_request_responses).find(params[:id])
    render json: { request: serialize(item, Set.new), responseTimePromise: UrgentConfig.response_time_promise }
  end

  def create
    item = UrgentRequest.create!(requester: current_user, title: params[:title], role_name: params[:roleName], instrument: params[:instrument],
      city: params[:city], start_at: params[:startAt], end_at: params[:endAt], budget_min: params[:budgetMin], budget_max: params[:budgetMax],
      currency: params[:currency].presence || "INR", genre: params[:genre], requirements: params[:requirements],
      travel_covered: params[:travelCovered] || false, status: "open")
    notified = UrgentMatcher.notify!(item)
    render json: { id: item.id, notifiedCount: notified.size, responseTimePromise: UrgentConfig.response_time_promise }, status: :created
  end

  def respond
    item = UrgentRequest.where(status: "open").find(params[:id]); return render_error("You cannot respond to your own request.", :conflict) if item.requester_id == current_user.id
    return render_error("Keep your note under 1,000 characters.", :unprocessable_content) if params[:message].to_s.length > 1_000
    rate = params[:rate].presence
    return render_error("Rate must be a whole number of 0 or more.", :unprocessable_content) if rate && !rate.to_s.match?(/\A\d{1,9}\z/)
    UrgentRequestResponse.upsert({ urgent_request_id: item.id, user_id: current_user.id, message: params[:message].to_s.strip.presence, rate: rate&.to_i, status: "available", created_at: Time.current, updated_at: Time.current }, unique_by: :idx_urgent_response_unique)
    Notification.create!(user: item.requester, kind: "urgent_response", title: "Availability response", body: "#{current_user.name} responded to #{item.title}.", link: "/urgent-requests")
    Notifier.milestone_first_urgent_response(current_user, item)
    render json: { ok: true }, status: :created
  end

  def responses
    item = UrgentRequest.where(requester: current_user).find(params[:id]); render json: { responses: item.urgent_request_responses.includes(user: :profile).order(created_at: :desc).limit(LIST_LIMIT).map { _1.attributes.merge(name: _1.user.name, headline: _1.user.profile&.headline) } }
  end

  def update
    item = UrgentRequest.where(requester: current_user).find(params[:id])
    return render_error("Invalid status", :bad_request) unless %w[filled cancelled closed].include?(params[:status])
    if params[:status] == "filled" && params[:filledByUserId].present?
      return render_error("Only someone who responded can be marked as filling this request.", :unprocessable_content) unless item.urgent_request_responses.exists?(user_id: params[:filledByUserId])
      item.update!(status: "filled", filled_by_id: params[:filledByUserId])
      Notifier.milestone_5th_filled_request(current_user)
    else
      item.update!(status: params[:status])
    end
    render json: { ok: true, request: serialize(item.reload, Set.new) }
  end

  # The one-click link in the expiry-warning email: GET .../urgent-requests/:id/token-action?action=filled|close&t=...
  # Requires no session; the signed token is the authorization. Marks the request filled
  # (with no particular responder chosen — the hirer can still pick one later on the request
  # page) or closed.
  def action_from_token
    # The action is read from the signed token itself (not from the "action" query param,
    # which Rails already reserves for the controller action name), so the token is the sole
    # source of authorization: it can only ever do what it was issued to do.
    payload = UrgentActionToken.verify(params[:t])
    return render_error("This link has expired or is invalid.", :unprocessable_content, "INVALID_TOKEN") unless payload
    return render_error("This link has expired or is invalid.", :unprocessable_content, "INVALID_TOKEN") unless payload["id"] == params[:id]

    item = UrgentRequest.find_by(id: payload["id"])
    return render_error("Request not found.", :not_found) unless item
    item.update!(status: payload["action"] == "filled" ? "filled" : "closed") if item.open?
    render json: { ok: true, status: item.status }
  end

  private

  def serialize(item, responded_ids, my_reasons = nil)
    item.attributes.merge(requesterName: item.requester.name, requesterVerified: item.requester.profile&.verified || false,
      myResponse: responded_ids.include?(item.id), responseCount: item.urgent_request_responses.size,
      myMatchReasons: my_reasons, filledByName: item.filled_by&.name)
  end
end
