# The "review changes" inbox of the identity the request acts as (see ShowcaseSuggestion):
# suggestions to add new or edited work samples and career entries to portfolios and resumes,
# and to tag work samples with what their text mentions.
class SuggestionsController < ApplicationController
  include ActingAs
  include ScalarParams

  LIST_LIMIT = 200

  before_action -> { authenticate!("jobseeker", "employer") }

  # ?status=pending (default) | accepted | rejected | obsolete | all; ?targetId= narrows to one
  # portfolio, resume or work sample.
  def index
    return unless require_scalar_params!(:status, :targetId)
    return unless (actor = current_actor)
    status = params[:status].presence || "pending"
    unless status == "all" || ShowcaseSuggestion::STATUSES.include?(status)
      return render_error("status must be one of: all, #{ShowcaseSuggestion::STATUSES.join(', ')}.", :bad_request, "INVALID_FILTER")
    end
    scope = ShowcaseSuggestion.owned_by(actor).order(created_at: :desc, id: :asc).limit(LIST_LIMIT)
    scope = scope.where(status:) unless status == "all"
    scope = scope.where(target_id: params[:targetId]) if params[:targetId].present?
    render json: { suggestions: scope.map(&:api_json), pending: ShowcaseSuggestion.owned_by(actor).pending.count }
  end

  def accept
    return unless (suggestion = owned_suggestion)
    applied = suggestion.accept!
    audit!("suggestion.accept", suggestion, actingAs: current_actor.key, applied:)
    render json: { suggestion: suggestion.reload.api_json, applied: }
  end

  def reject
    return unless (suggestion = owned_suggestion)
    suggestion.reject!
    audit!("suggestion.reject", suggestion, actingAs: current_actor.key)
    render json: { suggestion: suggestion.api_json }
  end

  # POST /api/suggestions/accept-all {targetId?}: accepts every pending suggestion (for one target).
  def accept_all
    return unless require_scalar_params!(:targetId)
    return unless (actor = current_actor)
    scope = ShowcaseSuggestion.owned_by(actor).pending.order(:created_at, :id).limit(LIST_LIMIT)
    scope = scope.where(target_id: params[:targetId]) if params[:targetId].present?
    results = scope.to_a.map { |suggestion| [suggestion.id, suggestion.accept!] }
    audit!("suggestion.accept_all", nil, actingAs: actor.key, accepted: results.count(&:last), total: results.length)
    render json: { accepted: results.select(&:last).map(&:first), obsolete: results.reject(&:last).map(&:first) }
  end

  private

  def owned_suggestion
    return nil unless (actor = current_actor)
    ShowcaseSuggestion.owned_by(actor).find(params[:id])
  end
end
