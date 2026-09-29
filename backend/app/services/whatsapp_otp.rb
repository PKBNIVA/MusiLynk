require "net/http"
require "uri"
require "json"

# Meta WhatsApp Cloud API adapter for one-time sign-in codes (see AuthController
# #phone_otp_request/#phone_otp_verify). Mirrors WhatsappAlerts (see its header for the
# Meta setup); this one is off unless every one of WHATSAPP_ACCESS_TOKEN,
# WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_OTP and WHATSAPP_ENABLED=true is set — built
# dark until a Railway owner sets WHATSAPP_TEMPLATE_OTP (and the shared WhatsApp variables).
#
# Never logs the access token or a full phone number; only the last 4 digits.
class WhatsappOtp
  API_VERSION = "v20.0".freeze
  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 5

  class Error < StandardError; end

  def self.enabled?
    ActiveModel::Type::Boolean.new.cast(ENV["WHATSAPP_ENABLED"]) == true &&
      ENV["WHATSAPP_ACCESS_TOKEN"].present? && ENV["WHATSAPP_PHONE_NUMBER_ID"].present? && ENV["WHATSAPP_TEMPLATE_OTP"].present?
  end

  # -> true, or raises Error (for a caller that wants to retry) on a network/HTTP failure.
  # Never raises for "not configured" — callers check .enabled? first.
  def self.send_code(phone:, code:, client: nil)
    new(client:).send_code(phone:, code:)
  end

  def initialize(client: nil)
    @client = client
  end

  def send_code(phone:, code:)
    body = {
      messaging_product: "whatsapp",
      to: phone.delete_prefix("+"),
      type: "template",
      template: {
        name: ENV.fetch("WHATSAPP_TEMPLATE_OTP"),
        language: { code: "en" },
        components: [{ type: "body", parameters: [{ type: "text", text: code }] }]
      }
    }.to_json

    status, raw = post(body)
    unless status.between?(200, 299)
      Rails.logger.error({ event: "whatsapp_otp_failed", status:, phoneLast4: phone.last(4) }.to_json)
      raise Error, "WhatsApp OTP send failed (#{status})"
    end
    Rails.logger.info({ event: "whatsapp_otp_sent", phoneLast4: phone.last(4) }.to_json)
    JSON.parse(raw)
    true
  rescue JSON::ParserError
    true
  end

  private

  def post(body)
    url = "https://graph.facebook.com/#{API_VERSION}/#{ENV.fetch('WHATSAPP_PHONE_NUMBER_ID')}/messages"
    headers = { "Content-Type" => "application/json", "Authorization" => "Bearer #{ENV.fetch('WHATSAPP_ACCESS_TOKEN')}" }
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
end
