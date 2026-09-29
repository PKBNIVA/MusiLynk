require "rails-html-sanitizer"

# Runs one of the fixed AiAssist::Tasks templates through the configured LLM provider
# (AiAssist::Providers::OpenAi by default, ::Anthropic as a config fallback; see
# config/ai_pricing.yml `provider:` and ENV["AI_PROVIDER"]).
#
# The client never sends a raw prompt: it sends a `task` key and a structured `context` hash.
# This service resolves the task to its server-side system prompt and prompt template, calls
# the provider, and returns plain, length-capped text. Model output is always treated as
# untrusted text — never HTML, never executed, never trusted for facts.
#
# Disabled (`enabled?` false) whenever the selected provider's key (OPENAI_API_KEY or
# ANTHROPIC_API_KEY) is blank or AI_ASSIST_ENABLED == "false".
# Nothing here ever logs a prompt, an API key or user-authored text: only task, provider,
# latency, token counts and status.
class AiAssist
  class Error < StandardError
    attr_reader :code, :http_status

    def initialize(message, code:, status: nil)
      super(message)
      @code = code
      @http_status = status
    end
  end

  # Pre-provider constants, kept for callers and specs; the Anthropic provider owns them now.
  DEFAULT_MODEL = "claude-haiku-4-5-20251001".freeze

  PROVIDERS = {
    "openai" => "AiAssist::Providers::OpenAi",
    "anthropic" => "AiAssist::Providers::Anthropic"
  }.freeze

  def self.provider_name = AiPricing.provider

  def self.provider_class = PROVIDERS.fetch(provider_name).constantize

  def self.enabled?
    provider_class.enabled? && ENV["AI_ASSIST_ENABLED"] != "false"
  end

  def self.model_name = provider_class.model_name

  # Launch mode: only the tasks AiPricing.enabled_tasks lists right now (see
  # config/ai_pricing.yml `launch:`). `known_task?` is the full registry, independent of that —
  # it's what tells a truly unknown task (422 UNKNOWN_TASK) apart from a real but currently
  # disabled one (403 AI_TASK_DISABLED).
  def self.tasks = AiAssist::Tasks::PUBLIC_TASKS.select { AiPricing.task_enabled?(_1) }

  def self.known_task?(task) = AiAssist::Tasks::PUBLIC_TASKS.include?(task.to_s)

  # Hard output caps (AiPricing.output_caps), by task shape: classification < short < long.
  # Every task's own max_output_tokens is capped down to this (never up) so a task-level cap can
  # tighten it further but never exceed the global hard cap.
  def self.max_tokens_for(task)
    caps = AiPricing.output_caps
    hard_cap = if task.to_s == "classify_portfolio_item"
      caps.fetch(:classification_max_tokens)
    elsif AiPricing.long_task?(task)
      caps.fetch(:long_max_tokens)
    else
      caps.fetch(:short_max_tokens)
    end
    spec_cap = AiAssist::Tasks::REGISTRY[task.to_s]&.max_output_tokens
    spec_cap ? [spec_cap, hard_cap].min : hard_cap
  end

  # `client:` is only ever supplied by tests. It must respond to
  # `#post(url, headers:, body:, open_timeout:, read_timeout:) -> [status_code, response_body_string]`.
  def initialize(client: nil)
    @client = client
  end

  # Returns { suggestion:, task:, model:, ... } or raises AiAssist::Error with a friendly message and code.
  def suggest(task:, context:)
    raise Error.new("AI assist is not enabled right now.", code: "AI_DISABLED") unless self.class.enabled?

    spec = AiAssist::Tasks::REGISTRY[task.to_s]
    raise Error.new("Unknown AI task.", code: "UNKNOWN_TASK") unless spec

    clean_context = AiAssist::Tasks.validate!(spec, context)
    user_prompt = spec.build_prompt(clean_context)
    max_tokens = self.class.max_tokens_for(task)
    schema = AiAssist::Tasks::JSON_SCHEMAS[task.to_s]

    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    begin
      result = provider.complete(system: spec.system_prompt, messages: [{ role: "user", content: user_prompt }],
        max_output_tokens: max_tokens, json_schema: schema && { name: schema.name, schema: schema.schema })
    rescue Error => e
      log(task:, status: failure_status(e), latency_ms: elapsed_ms(started))
      raise
    end

    if result.refused
      log(task:, status: "refused", latency_ms: elapsed_ms(started), input_tokens: result.input_tokens, output_tokens: result.output_tokens)
      raise Error.new("The AI assistant couldn't help with that.", code: "AI_REFUSED")
    end

    log(task:, status: "ok", latency_ms: elapsed_ms(started), input_tokens: result.input_tokens, output_tokens: result.output_tokens,
      cached_input_tokens: result.cached_input_tokens)

    text = schema&.render && result.parsed_json.is_a?(Hash) ? schema.render.call(result.parsed_json) : result.text
    { suggestion: sanitize_output(text, spec.max_output_chars), task: task.to_s, model: result.model, provider: self.class.provider_name,
      inputTokens: result.input_tokens, cachedInputTokens: result.cached_input_tokens, outputTokens: result.output_tokens }
  end

  # Raw single-call helper for services with their own system prompt (AiPortfolioItemClassifier)
  # rather than one of the fixed AiAssist::Tasks templates. Returns { text:, usage: }.
  def suggest_raw(model:, system_prompt:, user_prompt:, max_tokens:)
    result = provider(model:).complete(system: system_prompt, messages: [{ role: "user", content: user_prompt }], max_output_tokens: max_tokens)
    raise Error.new("The AI assistant couldn't help with that.", code: "AI_REFUSED") if result.refused

    { text: result.text, usage: { input: result.input_tokens, cached_input: result.cached_input_tokens, output: result.output_tokens } }
  end

  private

  def provider(model: nil) = self.class.provider_class.new(client: @client, model:)

  def elapsed_ms(started) = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round(1)

  def failure_status(error)
    case error.code
    when "AI_TIMEOUT" then "timeout"
    when "AI_UPSTREAM_ERROR" then "upstream_error_#{error.http_status}"
    else error.code.downcase
    end
  end

  def sanitize_output(text, max_chars)
    plain = AiAssist::Tasks.sanitizer.sanitize(text.to_s).strip
    plain[0, max_chars]
  end

  # Structured, non-sensitive only: task, latency, token counts, status. Never the prompt, the
  # context, the model's text or the API key.
  def log(task:, status:, latency_ms:, input_tokens: nil, output_tokens: nil, cached_input_tokens: nil)
    Rails.logger.info({
      event: "ai_assist", task: task.to_s, provider: self.class.provider_name, status:, latencyMs: latency_ms,
      inputTokens: input_tokens, cachedInputTokens: cached_input_tokens, outputTokens: output_tokens
    }.compact.to_json)
  end
end
