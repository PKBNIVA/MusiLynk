require "net/http"
require "uri"
require "json"

# Thin wrapper around Anthropic's Message Batches API (50% cheaper than a synchronous call),
# used only for the classify_portfolio_item task. Kept behind this object (rather than inline
# Net::HTTP calls in the job) so tests can stub it instead of hitting the network.
class BatchClient
  API_URL = "https://api.anthropic.com/v1/messages/batches".freeze
  ANTHROPIC_VERSION = "2023-06-01".freeze
  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 20

  class Error < StandardError; end

  def initialize(client: nil)
    @client = client
  end

  # requests: [{ custom_id:, model:, system:, prompt:, max_tokens: }] -> batch id (String)
  def submit(requests)
    body = { requests: requests.map { |r| { custom_id: r.fetch(:custom_id),
      params: { model: r.fetch(:model), max_tokens: r.fetch(:max_tokens), system: r.fetch(:system),
                messages: [{ role: "user", content: r.fetch(:prompt) }] } } } }.to_json
    status, raw = post(API_URL, body)
    raise Error, "batch submit failed (#{status})" unless status.to_i.between?(200, 299)

    JSON.parse(raw).fetch("id")
  end

  # -> { status:, results_url: } ("in_progress" | "ended" | ...)
  def status(batch_id)
    status, raw = get("#{API_URL}/#{batch_id}")
    raise Error, "batch status failed (#{status})" unless status.to_i.between?(200, 299)

    parsed = JSON.parse(raw)
    { status: parsed["processing_status"], results_url: parsed["results_url"] }
  end

  # -> [{ custom_id:, result: { type:, message: { content: [...] } } }] parsed from the
  # results file (JSONL: one JSON object per line).
  def results(results_url)
    status, raw = get(results_url)
    raise Error, "batch results failed (#{status})" unless status.to_i.between?(200, 299)

    raw.to_s.each_line.filter_map { |line| line.strip.presence && JSON.parse(line) }
  end

  private

  def headers
    { "content-type" => "application/json", "anthropic-version" => ANTHROPIC_VERSION, "x-api-key" => ENV["ANTHROPIC_API_KEY"].to_s }
  end

  def post(url, body)
    return @client.post(url, headers:, body:, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT) if @client

    uri = URI.parse(url)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = OPEN_TIMEOUT
    http.read_timeout = READ_TIMEOUT
    request = Net::HTTP::Post.new(uri.request_uri, headers)
    request.body = body
    response = http.request(request)
    [response.code.to_i, response.body]
  end

  def get(url)
    return @client.get(url, headers:, open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT) if @client

    uri = URI.parse(url)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = OPEN_TIMEOUT
    http.read_timeout = READ_TIMEOUT
    request = Net::HTTP::Get.new(uri.request_uri, headers)
    response = http.request(request)
    [response.code.to_i, response.body]
  end
end
