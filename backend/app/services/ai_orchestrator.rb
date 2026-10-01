# Wires AiAssist to the credits ledger, the spend guard and the result cache for every paid AI
# task (writing-help, recruiter and talent tasks alike). Callers (AiController, the recruiter
# controllers) never touch AiCredits/AiSpendGuard/AiResultCache directly — they call
# `AiOrchestrator.run` and get back a plain suggestion or a typed error.
#
# Order of operations, all before any API call:
#   1. AI must be enabled.
#   2. This period's allowance is granted lazily if due (verified-email gated for free tier).
#   3. The spend guard is checked (free-tier pause, hard stop) — admin calls skip it.
#   4. A cache hit short-circuits the API call entirely; it is still charged unless the account
#      is on a paid plan (pro/studio/enterprise) or has Verse AI Plus.
#   5. Otherwise the balance is checked and the credits are reserved (charged) before the call,
#      so a concurrent spend can never overdraw the account; a provider error or timeout refunds
#      the reservation, and a success updates it with the real token usage and cost.
class AiOrchestrator
  Outcome = Struct.new(:suggestion, :task, :model, :cached, :credits_charged, :balance, keyword_init: true)

  PAID_PLANS = %w[pro studio enterprise].freeze

  def self.paid_plan?(resolution) = PAID_PLANS.include?(resolution.plan_code) || resolution.ai_plus_active

  def self.tier_for(resolution) = paid_plan?(resolution) ? "paid" : "free"

  # `caller_fn` builds the AiAssist result for a cache miss: `-> { AiAssist.new.suggest(task:, context:) }`
  # (or an equivalent for a task with its own service, e.g. rank_applicants). It must return
  # `{ suggestion:, task:, model:, inputTokens:, outputTokens: }`.
  def self.run(user:, task:, context:, applicant_count: nil, admin: false, hirer: false, regenerate: false, now: Time.current, &caller_fn)
    raise AiAssist::Error.new("AI assist is not enabled right now.", code: "AI_DISABLED") unless AiAssist.enabled?

    resolution = AiCreditAccount.for(user)
    AiCredits.ensure_monthly_allowance!(resolution, hirer:, email_verified: user.email_verified?, now:)
    tier = tier_for(resolution)
    AiSpendGuard.check!(tier:, admin:, now:)

    cost = AiPricing.cost_for(task, applicant_count:)
    cache_key_context = context

    cached = AiResultCache.fetch(task.to_s, cache_key_context, resolution.account_type, resolution.account_id, regenerate:)
    if cached
      unless paid_plan?(resolution)
        charge!(resolution, cost:, task:, cached: true, tier:, now:)
      end
      return Outcome.new(suggestion: cached[:suggestion] || cached["suggestion"], task: task.to_s, model: cached[:model] || cached["model"],
        cached: true, credits_charged: paid_plan?(resolution) ? 0 : cost, balance: AiCredits.balance(resolution.account_type, resolution.account_id, now:))
    end

    rows = charge!(resolution, cost:, task:, cached: false, tier:, now:)
    begin
      result = caller_fn.call
    rescue => e
      AiCredits.refund!(rows, now:)
      raise
    end

    cost_inr = AiPricing.estimate_cost_inr(input_tokens: result[:inputTokens], output_tokens: result[:outputTokens], cached_input_tokens: result[:cachedInputTokens])
    Array(rows).first&.update!(tokens_in: result[:inputTokens], tokens_out: result[:outputTokens], cost_inr:)

    cacheable = { suggestion: result[:suggestion], model: result[:model] }
    AiResultCache.write(task.to_s, cache_key_context, resolution.account_type, resolution.account_id, cacheable, regenerate:)

    Outcome.new(suggestion: result[:suggestion], task: task.to_s, model: result[:model], cached: false, credits_charged: cost,
      balance: AiCredits.balance(resolution.account_type, resolution.account_id, now:))
  end

  def self.charge!(resolution, cost:, task:, cached:, tier:, now:)
    AiCredits.charge!(resolution, cost:, task: task.to_s, cached:, tier:, now:)
  end
end
