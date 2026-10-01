# Anthropic Messages API, moved behind the provider interface with unchanged behaviour
# (same URL, headers, payload, timeouts and error mapping as the pre-provider AiAssist).
class AiAssist::Providers::Anthropic < AiAssist::Providers::Base
  API_URL = "https://api.anthropic.com/v1/messages".freeze
  ANTHROPIC_VERSION = "2023-06-01".freeze
  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 20

  def self.name_key = "anthropic"
  def self.api_key_env = "ANTHROPIC_API_KEY"
  # ENV["AI_MODEL"] still pins a snapshot (legacy override).
  def self.model_name = ENV["AI_MODEL"].presence || super

  def complete(system:, messages:, max_output_tokens:, json_schema: nil)
    payload = { model:, max_tokens: max_output_tokens, system:, messages: }.to_json
    begin
      status, raw_body = post(API_URL, headers: request_headers, body: payload, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT)
    rescue *TRANSPORT_ERRORS
      raise AiAssist::Error.new("The AI assistant is taking too long. Try again in a moment.", code: "AI_TIMEOUT")
    end
    raise AiAssist::Error.new("The AI assistant is unavailable right now.", code: "AI_UPSTREAM_ERROR", status:) unless status == 200

    parse(raw_body, json_schema)
  end

  private

  def request_headers
    { "content-type" => "application/json", "anthropic-version" => ANTHROPIC_VERSION, "x-api-key" => self.class.api_key }
  end

  # { content: [{ type: "text", text: "..." }], usage: { input_tokens:, output_tokens: } }.
  # Any deviation (malformed JSON, missing keys, wrong types) is a malformed response.
  def parse(raw_body, json_schema)
    parsed = JSON.parse(raw_body.to_s)
    blocks = parsed.fetch("content")
    malformed! unless blocks.is_a?(Array)

    usage = parsed["usage"].is_a?(Hash) ? parsed["usage"] : {}
    cached = usage["cache_read_input_tokens"].to_i
    tokens = { input_tokens: usage["input_tokens"].nil? ? nil : usage["input_tokens"].to_i + cached,
               cached_input_tokens: cached, output_tokens: usage["output_tokens"] }
    return Result.new(text: nil, parsed_json: nil, model:, refused: true, **tokens) if parsed["stop_reason"] == "refusal"

    text = blocks.select { _1.is_a?(Hash) && _1["type"] == "text" }.map { _1["text"].to_s }.join
    malformed!("The AI assistant returned an empty suggestion.") if text.strip.empty?

    Result.new(text:, parsed_json: json_schema ? parse_json_or_nil(text) : nil, model:, refused: false, **tokens)
  rescue JSON::ParserError, KeyError, TypeError, NoMethodError
    malformed!
  end
end
