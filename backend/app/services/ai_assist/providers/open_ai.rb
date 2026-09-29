# OpenAI Responses API (POST /v1/responses) over plain Net::HTTP.
#
# - The stable system prompt goes in `instructions` (first in the prompt prefix) so OpenAI's
#   automatic prompt caching applies; cached tokens come back in
#   usage.input_tokens_details.cached_tokens and are billed at the cached rate.
# - `json_schema` maps to text.format { type: "json_schema", strict: true }.
# - Reasoning is turned off (effort "none"): max_output_tokens also budgets reasoning tokens, and
#   these are short copy-writing / extraction calls that gain nothing from it.
# - One retry on 429 / 5xx after a jittered pause. Timeouts and other statuses are not retried.
# - Never logs prompts, response bodies or the key (store: false keeps them out of OpenAI logs too).
class AiAssist::Providers::OpenAi < AiAssist::Providers::Base
  API_URL = "https://api.openai.com/v1/responses".freeze
  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 30
  RETRYABLE = ->(status) { status == 429 || status.to_i.between?(500, 599) }

  class_attribute :retry_delay_range, default: (0.3..0.9)

  def self.name_key = "openai"
  def self.api_key_env = "OPENAI_API_KEY"
  def self.model_name = ENV["OPENAI_MODEL"].presence || super

  def complete(system:, messages:, max_output_tokens:, json_schema: nil)
    body = request_body(system:, messages:, max_output_tokens:, json_schema:).to_json
    status, raw_body = post_with_retry(body)
    raise AiAssist::Error.new("The AI assistant is unavailable right now.", code: "AI_UPSTREAM_ERROR", status:) unless status == 200

    parse(raw_body, json_schema)
  end

  private

  def request_body(system:, messages:, max_output_tokens:, json_schema:)
    body = {
      model:, instructions: system, input: messages.map { { role: _1[:role], content: _1[:content] } },
      max_output_tokens:, reasoning: { effort: "none" }, store: false
    }
    if json_schema
      body[:text] = { format: { type: "json_schema", name: json_schema.fetch(:name), strict: true, schema: json_schema.fetch(:schema) } }
    end
    body
  end

  def request_headers
    { "content-type" => "application/json", "authorization" => "Bearer #{self.class.api_key}" }
  end

  def post_with_retry(body)
    status, raw = send_request(body)
    if RETRYABLE.call(status)
      sleep(rand(retry_delay_range))
      status, raw = send_request(body)
    end
    [status, raw]
  end

  def send_request(body)
    post(API_URL, headers: request_headers, body:, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT)
  rescue *TRANSPORT_ERRORS
    raise AiAssist::Error.new("The AI assistant is taking too long. Try again in a moment.", code: "AI_TIMEOUT")
  end

  # { status:, output: [{ type: "message", content: [{ type: "output_text", text: } | { type: "refusal", refusal: }] }],
  #   usage: { input_tokens:, input_tokens_details: { cached_tokens: }, output_tokens: } }
  def parse(raw_body, json_schema)
    parsed = JSON.parse(raw_body.to_s)
    malformed! unless parsed.is_a?(Hash)

    usage = parsed["usage"].is_a?(Hash) ? parsed["usage"] : {}
    cached = usage.dig("input_tokens_details", "cached_tokens").to_i
    tokens = { input_tokens: usage["input_tokens"], cached_input_tokens: cached, output_tokens: usage["output_tokens"] }

    parts = Array(parsed["output"]).select { _1.is_a?(Hash) && _1["type"] == "message" }.flat_map { Array(_1["content"]) }.grep(Hash)
    refused = parts.any? { _1["type"] == "refusal" } || parsed.dig("incomplete_details", "reason") == "content_filter"
    return Result.new(text: nil, parsed_json: nil, model:, refused: true, **tokens) if refused

    text = parts.select { _1["type"] == "output_text" }.map { _1["text"].to_s }.join
    malformed!("The AI assistant returned an empty suggestion.") if text.strip.empty?

    Result.new(text:, parsed_json: json_schema ? parse_json_or_nil(text) : nil, model:, refused: false, **tokens)
  rescue JSON::ParserError, TypeError, NoMethodError
    malformed!
  end
end
