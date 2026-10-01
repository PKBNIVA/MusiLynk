module Admin
  # Hand-matching screen for the "need someone by tomorrow" wedge: the founder works this list
  # during the beta (see docs/VERSE_PLAN.md). Every action here is audited (BaseController + audit!).
  class UrgentRequestsController < BaseController
    include AdminPagination
    STATUSES = UrgentRequest::STATUSES

    # ?status=open (default) | any of UrgentRequest::STATUSES | "all". Sorted by deadline
    # (start_at) ascending so the most urgent request is always first.
    def index
      scope = UrgentRequest.includes(:urgent_request_responses, :filled_by, requester: :profile).order(start_at: :asc)
      status = params[:status].presence || "open"
      scope = scope.where(status:) if STATUSES.include?(status)
      rows, meta = admin_paginate(scope, default_per: 100)
      render json: { requests: rows.map { serialize(_1) }, funnel: }.merge(meta)
    end

    # The ranked candidate list for one request (UrgentMatcher), with who's already been
    # notified and who's already responded, so the founder doesn't double-alert someone.
    def candidates
      item = UrgentRequest.find(params[:id])
      notified_ids = item.urgent_request_notifications.pluck(:user_id).to_set
      responded_ids = item.urgent_request_responses.pluck(:user_id).to_set
      ranked = UrgentMatcher.call(item)
      render json: { candidates: ranked.map { |c| serialize_candidate(c, notified_ids, responded_ids) } }
    end

    # Sends (or re-sends, on a fresh channel) the alert to exactly one candidate.
    def notify
      item = UrgentRequest.find(params[:id])
      target_id = params[:candidateUserId]
      return render_error("Choose who to notify.", :bad_request, "MISSING_CANDIDATE") if target_id.blank?
      return render_error("That person hasn't responded to and isn't eligible for this request.", :not_found, "CANDIDATE_NOT_FOUND") unless User.exists?(id: target_id)

      notified = UrgentMatcher.notify!(item, actor_admin: current_user, only_user_ids: [target_id])
      audit!("admin.urgent_request.notify", item, candidateUserId: target_id, sent: notified.any?)
      render json: { ok: true, sent: notified.any? }
    end

    # status: filled (with filledByUserId) | cancelled | expired | open (reopen). founderNotes
    # can be set alongside, or on its own with no status change.
    def update
      item = UrgentRequest.find(params[:id])
      if params.key?(:status)
        return render_error("Invalid status.", :bad_request, "INVALID_STATUS") unless STATUSES.include?(params[:status])
        if params[:status] == "filled" && params[:filledByUserId].present?
          return render_error("Only someone who responded can be marked as filling this request.", :unprocessable_content, "NOT_A_RESPONDER") unless item.urgent_request_responses.exists?(user_id: params[:filledByUserId])
          item.filled_by_id = params[:filledByUserId]
        end
        item.status = params[:status]
      end
      item.founder_notes = params[:founderNotes] if params.key?(:founderNotes)
      item.save!
      audit!("admin.urgent_request.update", item, status: item.status, filledByUserId: item.filled_by_id, notesChanged: params.key?(:founderNotes))
      render json: { ok: true, request: serialize(item.reload) }
    end

    private

    def funnel
      today = UrgentRequest.where(created_at: Time.current.beginning_of_day..Time.current.end_of_day)
      {
        requestsToday: today.count,
        notifiedToday: today.where("notified_count > 0").count,
        respondedToday: today.where(id: UrgentRequestResponse.select(:urgent_request_id)).count,
        filledWithin24hToday: today.where(status: "filled").where("updated_at <= created_at + interval '24 hours'").count
      }
    end

    def serialize(item)
      item.attributes.merge(
        requesterName: item.requester.name,
        ageMinutes: item.age_minutes,
        responseCount: item.urgent_request_responses.size,
        noResponseAfterWindow: item.status == "open" && item.urgent_request_responses.empty? && item.age_minutes > UrgentConfig.no_response_after.to_i / 60,
        filledByName: item.filled_by&.name
      )
    end

    def serialize_candidate(candidate, notified_ids, responded_ids)
      user = candidate.user
      profile = user.profile
      {
        userId: user.id, name: user.name, score: candidate.score, reasons: candidate.reasons,
        city: profile&.location, verified: profile&.verified || false,
        lastActiveAt: user.sessions.maximum(:last_seen_at),
        alreadyNotified: notified_ids.include?(user.id), alreadyResponded: responded_ids.include?(user.id)
      }
    end
  end
end
