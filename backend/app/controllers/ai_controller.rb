# AI writing help: always a suggestion the user accepts or edits, never sent on their behalf.
#
# The client never sends a raw prompt — only a `task` (from the fixed AiAssist::Tasks allow-list)
# and structured `context`. Tasks that reference a job or a conversation are resolved and access
# checked here before AiAssist ever sees them.
class AiController < ApplicationController
  include UserRateLimit

  SUGGEST_LIMIT_PER_HOUR = 30
  SUGGEST_LIMIT_PER_DAY = 150
  MESSAGE_HISTORY_FOR_REPLY = 5

  before_action -> { authenticate! }, only: %i[suggest]

  # GET /api/ai/status — no auth required, so the UI can hide AI buttons before sign-in too.
  def status
    render json: { enabled: AiAssist.enabled?, tasks: AiAssist.tasks }
  end

  # POST /api/ai/suggest { task, context }
  def suggest
    return render_error("AI assist is not enabled right now.", :service_unavailable, "AI_DISABLED") unless AiAssist.enabled?
    return unless daily_budget_available?
    return unless within_user_rate_limit?("ai-suggest-hour", limit: SUGGEST_LIMIT_PER_HOUR, period: 1.hour)
    return unless within_user_rate_limit?("ai-suggest-day", limit: SUGGEST_LIMIT_PER_DAY, period: 1.day)

    task = params[:task].to_s
    return render_error("Unknown AI task.", :unprocessable_content, "UNKNOWN_TASK") unless AiAssist.tasks.include?(task)

    context = resolve_context(task, (params[:context].is_a?(ActionController::Parameters) ? params[:context].to_unsafe_h : params[:context]) || {})
    return if performed?

    spend_daily_budget!
    result = AiAssist.new.suggest(task:, context:)
    render json: result
  rescue AiAssist::Error => e
    status = e.code == "AI_DISABLED" ? :service_unavailable : (e.code == "INVALID_CONTEXT" || e.code == "UNKNOWN_TASK" ? :unprocessable_content : :bad_gateway)
    render_error(e.message, status, e.code)
  end

  # GET /api/ai/autocomplete?field=skills|genres|instruments|roles|cities&q=
  # Works without AI, backed by the taxonomy. Never rate-limited beyond the plain read cost, and
  # available even signed out (matches the public taxonomy endpoint).
  def autocomplete
    field = params[:field].to_s
    query = params[:q].to_s.strip
    return render_error("Unknown autocomplete field.", :unprocessable_content, "UNKNOWN_FIELD") unless AutocompleteTaxonomy::FIELDS.include?(field)

    matches = AutocompleteTaxonomy.match(field, query)
    if AiAssist.enabled? && matches.size < 3 && query.present? && current_user
      matches += ai_autocomplete_fill(field, query, matches)
    end
    render json: { field:, query:, suggestions: matches.first(10) }
  end

  private

  # Builds the server-side context for tasks that must fetch data themselves rather than trust
  # the client's copy of it, and access-checks anything the client points at by id. Renders an
  # error and returns nil when access is refused; otherwise returns the context hash to validate.
  def resolve_context(task, raw_context)
    context = raw_context.is_a?(Hash) ? raw_context : {}

    case task
    when "message_reply"
      conversation = Conversation.find_by(id: context["conversationId"] || context[:conversationId])
      unless conversation&.includes_user?(current_user)
        render_error("You can't use AI assist on this conversation.", :forbidden, "AI_ACCESS_DENIED")
        return nil
      end
      messages = conversation.messages.order(created_at: :desc, id: :desc).limit(MESSAGE_HISTORY_FOR_REPLY).to_a.reverse
      { "messages" => messages.map { "#{_1.sender_id == current_user.id ? 'me' : 'them'}: #{_1.body}" } }
    when "job_description", "job_screening_questions", "cover_letter"
      job_id = context["jobId"] || context[:jobId]
      if job_id.present?
        job = Job.find_by(id: job_id)
        unless job && (job.published? || job.employer_id == current_user.id || current_user.admin?)
          render_error("You can't use AI assist on this job.", :forbidden, "AI_ACCESS_DENIED")
          return nil
        end
      end
      context
    else
      context
    end
  end

  def ai_autocomplete_fill(field, query, existing)
    context = { field:, query:, existing: existing.map { _1[:value] } }
    result = AiAssist.new.suggest(task: "autocomplete", context:)
    result[:suggestion].to_s.split("\n").map(&:strip).reject(&:blank?).first(5).map { { value: _1, source: "ai" } }
  rescue AiAssist::Error, StandardError
    []
  end

  # A shared, cross-user budget so a burst of AI use never runs away the bill. Counted once per
  # UTC calendar day in Rails.cache; over the cap answers 429 AI_BUDGET_EXHAUSTED before any
  # per-user rate limit or API call.
  def daily_budget_available?
    cap = Integer(ENV["AI_DAILY_REQUEST_CAP"].presence || "2000", exception: false) || 2000
    used = Rails.cache.read(budget_key).to_i
    return true if used < cap

    render_error("AI assist has reached today's usage limit. Please try again tomorrow.", :too_many_requests, "AI_BUDGET_EXHAUSTED")
    false
  end

  def spend_daily_budget!
    Rails.cache.increment(budget_key, 1, expires_in: 25.hours)
  end

  def budget_key = "ai-assist:daily-budget:#{Time.current.utc.to_date}"
end
