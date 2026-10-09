# AI writing help: always a suggestion the user accepts or edits, never sent on their behalf.
#
# The client never sends a raw prompt — only a `task` (from the fixed AiAssist::Tasks allow-list)
# and structured `context`. Tasks that reference a job or a conversation are resolved and access
# checked here before AiAssist ever sees them.
class AiController < ApplicationController
  include UserRateLimit

  SUGGEST_LIMIT_PER_HOUR = RateLimits.limit("ai-suggest-hour")
  SUGGEST_LIMIT_PER_DAY = RateLimits.limit("ai-suggest-day")
  MESSAGE_HISTORY_FOR_REPLY = 5

  before_action -> { authenticate! }, only: %i[suggest usage]

  # GET /api/ai/status — no auth required, so the UI can hide AI buttons before sign-in too.
  def status
    render json: { enabled: AiAssist.enabled?, tasks: AiAssist.tasks }
  end

  # POST /api/ai/suggest { task, context, regenerate }
  def suggest
    return render_error("AI assist is not enabled right now.", :service_unavailable, "AI_DISABLED") unless AiAssist.enabled?
    return unless daily_budget_available?
    return unless within_user_rate_limit?("ai-suggest-hour")
    return unless within_user_rate_limit?("ai-suggest-day")

    task = params[:task].to_s
    return render_error("Unknown AI task.", :unprocessable_content, "UNKNOWN_TASK") unless AiAssist.known_task?(task)
    return render_error("This AI feature isn't available right now.", :forbidden, "AI_TASK_DISABLED") unless AiPricing.task_enabled?(task)

    context = resolve_context(task, (params[:context].is_a?(ActionController::Parameters) ? params[:context].to_unsafe_h : params[:context]) || {})
    return if performed?

    AiUsageCap.check!(current_user, task:)
    spend_daily_budget!
    applicant_count = task == "rank_applicants" ? Array(context["applicants"] || context[:applicants]).size : nil
    outcome = AiOrchestrator.run(user: current_user, task:, context:, hirer: current_user.role == "employer", applicant_count:,
      regenerate: ActiveModel::Type::Boolean.new.cast(params[:regenerate])) do
      AiAssist.new.suggest(task:, context:)
    end
    suggestion = validate_structured_output(task, context, outcome.suggestion)
    render json: { suggestion:, task: outcome.task, model: outcome.model, cached: outcome.cached, creditsCharged: outcome.credits_charged, balance: outcome.balance }
  rescue AiAssist::Error => e
    status = e.code == "AI_DISABLED" ? :service_unavailable : (e.code == "INVALID_CONTEXT" || e.code == "UNKNOWN_TASK" ? :unprocessable_content : :bad_gateway)
    render_error(e.message, status, e.code)
  rescue AiUsageCap::Exceeded => e
    render json: { error: e.message, code: "AI_USAGE_LIMIT_REACHED", remaining: e.remaining, limit: e.limit, period: e.period }, status: :payment_required
  rescue AiCredits::InsufficientCredits => e
    render_credits_exhausted(e)
  rescue AiSpendGuard::Paused => e
    render_error(e.message, :payment_required, e.code)
  end

  # GET /api/ai/usage — the signed-in account's launch-mode usage cap for its own task group
  # (talent: lifetime; hirer: monthly). No balance, no allowance, no "credits" — just how many
  # of the free AI uses are left, for the small hint next to the AI buttons.
  def usage
    render json: AiUsageCap.for(current_user, hirer: current_user.role == "employer")
  end

  # GET /api/ai/pricing — public catalogue.
  def pricing
    render json: AiPricing.public_catalogue
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
    when "candidate_summary", "rank_applicants", "outreach_message", "interview_questions", "rejection_note"
      job_id = context["jobId"] || context[:jobId]
      job = Job.find_by(id: job_id)
      unless job && recruiter_for?(job)
        render_error("You can't use AI assist on this job.", :forbidden, "AI_ACCESS_DENIED")
        return nil
      end
      context
    else
      context
    end
  end

  # A recruiter task's caller must be the job's employer, an admin, or a member of the
  # organization the employer owns (the closest thing this codebase has to "a workspace member
  # with a hiring role" — Job has no direct organization/workspace link of its own).
  # Strictly validates a structured task's output against the ids the caller actually gave, so
  # the model can never surface an application/item/entry id it invented. Returns the model's
  # text unchanged for a task with no id-shaped output; drops any element with an unknown id.
  def validate_structured_output(task, context, suggestion)
    known_ids, field = case task
    when "rank_applicants" then [Array(context["applicants"] || context[:applicants]).map { (_1.is_a?(Hash) ? (_1["id"] || _1[:id]) : nil).to_s }, "applicationId"]
    when "draft_portfolio" then [Array(context["items"] || context[:items]).map { (_1.is_a?(Hash) ? (_1["id"] || _1[:id]) : nil).to_s }, "itemIds"]
    when "tailor_resume" then [Array(context["entries"] || context[:entries]).map { (_1.is_a?(Hash) ? (_1["id"] || _1[:id]) : nil).to_s }, "entryIds"]
    else return suggestion
    end

    parsed = JSON.parse(suggestion)
    case task
    when "rank_applicants"
      raise AiAssist::Error.new("The AI assistant returned something unexpected.", code: "AI_MALFORMED_RESPONSE") unless parsed.is_a?(Array)
      parsed.select { _1.is_a?(Hash) && known_ids.include?(_1[field].to_s) }.to_json
    else
      raise AiAssist::Error.new("The AI assistant returned something unexpected.", code: "AI_MALFORMED_RESPONSE") unless parsed.is_a?(Hash)
      parsed[field] = Array(parsed[field]).map(&:to_s).select { known_ids.include?(_1) }
      parsed.to_json
    end
  rescue JSON::ParserError
    raise AiAssist::Error.new("The AI assistant returned something unexpected.", code: "AI_MALFORMED_RESPONSE")
  end

  def recruiter_for?(job)
    return true if current_user.admin? || job.employer_id == current_user.id

    Organization.where(owner_id: job.employer_id).joins(:organization_members).where(organization_members: { user_id: current_user.id }).exists?
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

  def render_credits_exhausted(error)
    report_handled_server_error(:payment_required, "AI_CREDITS_EXHAUSTED")
    render json: { error: "You're out of AI credits.", code: "AI_CREDITS_EXHAUSTED", balance: error.balance, resetsAt: error.resets_at,
      upgradeOptions: AiUsageReport.upgrade_options }, status: :payment_required
  end
end
