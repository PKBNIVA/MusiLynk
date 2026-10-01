require "net/http"
require "uri"

# The seam between AiAssist and a concrete LLM vendor. AiAssist (task registry, validation,
# sanitising, logging) never knows which vendor answered; it only calls `#complete` and reads a
# Result. Selection is by config (AiPricing.provider / AI_PROVIDER), see AiAssist.provider_class.
#
#   complete(system:, messages:, max_output_tokens:, json_schema: nil) -> Result
#
# `messages` is [{ role: "user", content: "..." }]. `json_schema`, when given, is
# { name:, schema: } (a strict JSON Schema); providers that support structured output enforce
# it, others rely on the prompt. Errors raise AiAssist::Error (AI_TIMEOUT, AI_UPSTREAM_ERROR,
# AI_MALFORMED_RESPONSE); a vendor refusal is reported as Result#refused, not an exception.
#
# Nothing here ever logs a prompt, a response body or an API key.
class AiAssist::Providers::Base
  Result = Struct.new(:text, :parsed_json, :input_tokens, :cached_input_tokens, :output_tokens, :model, :refused, keyword_init: true)

  TRANSPORT_ERRORS = [Net::OpenTimeout, Net::ReadTimeout, Timeout::Error, IOError, SocketError, Errno::ECONNREFUSED, Errno::ECONNRESET].freeze

  # `client:` is only ever supplied by tests. It must respond to
  # `#post(url, headers:, body:, open_timeout:, read_timeout:) -> [status_code, response_body_string]`.
  def initialize(client: nil, model: nil)
    @client = client
    @model = model.presence || self.class.model_name
  end

  attr_reader :model

  def self.name_key = raise(NotImplementedError)
  def self.api_key_env = raise(NotImplementedError)
  def self.api_key = ENV[api_key_env].to_s.strip
  def self.enabled? = api_key.present?
  def self.config = AiPricing.provider_config(name_key)
  def self.model_name = config.fetch(:model)

  def complete(system:, messages:, max_output_tokens:, json_schema: nil) = raise(NotImplementedError)

  private

  def post(url, headers:, body:, open_timeout:, read_timeout:)
    return @client.post(url, headers:, body:, open_timeout:, read_timeout:) if @client

    uri = URI.parse(url)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = open_timeout
    http.read_timeout = read_timeout
    request = Net::HTTP::Post.new(uri.request_uri, headers)
    request.body = body
    response = http.request(request)
    [response.code.to_i, response.body]
  end

  def malformed!(message = "The AI assistant returned something unexpected.")
    raise AiAssist::Error.new(message, code: "AI_MALFORMED_RESPONSE")
  end

  def parse_json_or_nil(text)
    JSON.parse(text.to_s)
  rescue JSON::ParserError
    nil
  end
end
