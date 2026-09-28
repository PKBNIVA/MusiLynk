require "net/http"
require "uri"
require "rails-html-sanitizer"

# Calls the Anthropic Messages API on behalf of one of the fixed AiAssist::Tasks templates.
#
# The client never sends a raw prompt: it sends a `task` key and a structured `context` hash.
# This service resolves the task to its server-side system prompt and prompt template, calls
# Anthropic, and returns plain, length-capped text. Model output is always treated as untrusted
# text — never HTML, never executed, never trusted for facts.
#
# Disabled (`enabled?` false) whenever ANTHROPIC_API_KEY is blank or AI_ASSIST_ENABLED == "false".
# Nothing here ever logs a prompt, an API key or user-authored text: only task, latency, token
# counts and status.
class AiAssist
  class Error < StandardError
    attr_reader :code

    def initialize(message, code:)
      super(message)
      @code = code
    end
  end

  API_URL = "https://api.anthropic.com/v1/messages".freeze
  ANTHROPIC_VERSION = "2023-06-01".freeze
  # Haiku only, everywhere: it is the only model any AiAssist task uses. ENV["AI_MODEL"] can
  # still override it (e.g. to pin a dated snapshot), but there is no separate "long" model —
  # long tasks get a bigger output cap (AiPricing.output_caps), never a bigger model.
  DEFAULT_MODEL = "claude-haiku-4-5-20251001".freeze
  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 20

  def self.enabled?
    ENV["ANTHROPIC_API_KEY"].to_s.strip.present? && ENV["AI_ASSIST_ENABLED"] != "false"
  end

  def self.model_name
    ENV["AI_MODEL"].presence || DEFAULT_MODEL
  end

  def self.tasks = AiAssist::Tasks::PUBLIC_TASKS

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

  # Returns { suggestion:, task:, model: } or raises AiAssist::Error with a friendly message and code.
  def suggest(task:, context:)
    raise Error.new("AI assist is not enabled right now.", code: "AI_DISABLED") unless self.class.enabled?

    spec = AiAssist::Tasks::REGISTRY[task.to_s]
    raise Error.new("Unknown AI task.", code: "UNKNOWN_TASK") unless spec

    clean_context = AiAssist::Tasks.validate!(spec, context)
    user_prompt = spec.build_prompt(clean_context)
    model = self.class.model_name
    max_tokens = self.class.max_tokens_for(task)

    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    begin
      status, raw_body = call_anthropic(model:, system_prompt: spec.system_prompt, user_prompt:, max_tokens:)
    rescue Net::OpenTimeout, Net::ReadTimeout, Timeout::Error, IOError, SocketError, Errno::ECONNREFUSED => e
      log(task:, status: "timeout", latency_ms: elapsed_ms(started))
      raise Error.new("The AI assistant is taking too long. Try again in a moment.", code: "AI_TIMEOUT")
    end

    unless status == 200
      log(task:, status: "upstream_error_#{status}", latency_ms: elapsed_ms(started))
      raise Error.new("The AI assistant is unavailable right now.", code: "AI_UPSTREAM_ERROR")
    end

    text, usage = extract_text_and_usage(raw_body)
    log(task:, status: "ok", latency_ms: elapsed_ms(started), input_tokens: usage[:input], output_tokens: usage[:output])

    { suggestion: sanitize_output(text, spec.max_output_chars), task: task.to_s, model:,
      inputTokens: usage[:input], outputTokens: usage[:output] }
  end

  # Raw single-call helper for services with their own system prompt (AiPortfolioItemClassifier)
  # rather than one of the fixed AiAssist::Tasks templates. Returns { text:, usage: }.
  def suggest_raw(model:, system_prompt:, user_prompt:, max_tokens:)
    status, raw_body = call_anthropic(model:, system_prompt:, user_prompt:, max_tokens:)
    raise Error.new("The AI assistant is unavailable right now.", code: "AI_UPSTREAM_ERROR") unless status == 200

    text, usage = extract_text_and_usage(raw_body)
    { text:, usage: }
  rescue Net::OpenTimeout, Net::ReadTimeout, Timeout::Error, IOError, SocketError, Errno::ECONNREFUSED
    raise Error.new("The AI assistant is taking too long. Try again in a moment.", code: "AI_TIMEOUT")
  end

  private

  def elapsed_ms(started) = ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round(1)

  def call_anthropic(model:, system_prompt:, user_prompt:, max_tokens:)
    payload = {
      model:, max_tokens:, system: system_prompt,
      messages: [{ role: "user", content: user_prompt }]
    }.to_json

    if @client
      @client.post(API_URL, headers: request_headers, body: payload, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT)
    else
      perform_http_post(payload)
    end
  end

  def request_headers
    {
      "content-type" => "application/json",
      "anthropic-version" => ANTHROPIC_VERSION,
      "x-api-key" => ENV["ANTHROPIC_API_KEY"].to_s
    }
  end

  def perform_http_post(payload)
    uri = URI.parse(API_URL)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = OPEN_TIMEOUT
    http.read_timeout = READ_TIMEOUT
    request = Net::HTTP::Post.new(uri.request_uri, request_headers)
    request.body = payload
    response = http.request(request)
    [response.code.to_i, response.body]
  end

  # Anthropic's Messages API shape: { content: [{ type: "text", text: "..." }], usage: { input_tokens:, output_tokens: } }.
  # Any deviation (malformed JSON, missing keys, wrong types) is treated as a malformed response.
  def extract_text_and_usage(raw_body)
    parsed = JSON.parse(raw_body.to_s)
    blocks = parsed.fetch("content")
    raise Error.new("The AI assistant returned something unexpected.", code: "AI_MALFORMED_RESPONSE") unless blocks.is_a?(Array)

    text = blocks.select { _1.is_a?(Hash) && _1["type"] == "text" }.map { _1["text"].to_s }.join
    raise Error.new("The AI assistant returned an empty suggestion.", code: "AI_MALFORMED_RESPONSE") if text.strip.empty?

    usage = parsed["usage"].is_a?(Hash) ? parsed["usage"] : {}
    [text, { input: usage["input_tokens"], output: usage["output_tokens"] }]
  rescue JSON::ParserError, KeyError, TypeError, NoMethodError
    raise Error.new("The AI assistant returned something unexpected.", code: "AI_MALFORMED_RESPONSE")
  end

  def sanitize_output(text, max_chars)
    plain = AiAssist::Tasks.sanitizer.sanitize(text.to_s).strip
    plain[0, max_chars]
  end

  # Structured, non-sensitive only: task, latency, token counts, status. Never the prompt, the
  # context, the model's text or the API key.
  def log(task:, status:, latency_ms:, input_tokens: nil, output_tokens: nil)
    Rails.logger.info({
      event: "ai_assist", task: task.to_s, status:, latencyMs: latency_ms,
      inputTokens: input_tokens, outputTokens: output_tokens
    }.compact.to_json)
  end
end
