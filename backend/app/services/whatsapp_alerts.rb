require "net/http"
require "uri"
require "json"

# Meta WhatsApp Cloud API adapter for urgent-hire alerts. Off unless every one of
# WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_URGENT and
# WHATSAPP_ENABLED=true is set (see backend/docs/whatsapp-alerts.md for what the owner sets
# up in Meta Business and which Railway variables to add).
#
# Only sent to a user who added phone_e164 and ticked WhatsApp consent (whatsapp_consented_at)
# on their profile — see ProfilesController#whatsapp_consent. Email keeps going regardless of
# WhatsApp: this is an addition, never a replacement (see Notifier#urgent_request_alert).
#
# Never logs the access token or a full phone number; only the last 4 digits, for support.
class WhatsappAlerts
  API_VERSION = "v20.0".freeze
  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 5

  class Error < StandardError; end

  def self.enabled?
    ActiveModel::Type::Boolean.new.cast(ENV["WHATSAPP_ENABLED"]) &&
      ENV["WHATSAPP_ACCESS_TOKEN"].present? && ENV["WHATSAPP_PHONE_NUMBER_ID"].present? && ENV["WHATSAPP_TEMPLATE_URGENT"].present?
  end

  # A user is a candidate for a WhatsApp alert once they've added a number and consented,
  # independent of whether the feature is currently enabled (so the UI can show "on the way"
  # state consistently and #send_urgent_alert can still explain why nothing went out).
  def self.eligible?(user)
    profile = user.respond_to?(:profile) ? user.profile : nil
    profile&.phone_e164.present? && profile&.whatsapp_consented_at.present?
  end

  # -> { sent:, reason: } — never raises for "not configured"/"not eligible"; raises Error (for
  # WhatsappAlertJob to retry) only on a network/HTTP failure once we know we should be sending.
  def self.send_urgent_alert(urgent_request, user, client: nil)
    new(client:).send_urgent_alert(urgent_request, user)
  end

  def initialize(client: nil)
    @client = client
  end

  def send_urgent_alert(urgent_request, user)
    return { sent: false, reason: "not_configured" } unless self.class.enabled?
    return { sent: false, reason: "not_eligible" } unless self.class.eligible?(user)

    phone = user.profile.phone_e164
    body = {
      messaging_product: "whatsapp",
      to: phone.delete_prefix("+"),
      type: "template",
      template: {
        name: ENV.fetch("WHATSAPP_TEMPLATE_URGENT"),
        language: { code: "en" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: urgent_request.role_name.to_s },
            { type: "text", text: urgent_request.city.to_s },
            { type: "text", text: urgent_request.start_at&.strftime("%d %b, %I:%M %p").to_s }
          ]
        }]
      }
    }.to_json

    status, raw = post(body)
    unless status.between?(200, 299)
      Rails.logger.error({ event: "whatsapp_alert_failed", status:, requestId: urgent_request.id, phoneLast4: phone.last(4) }.to_json)
      raise Error, "WhatsApp send failed (#{status})"
    end
    Rails.logger.info({ event: "whatsapp_alert_sent", requestId: urgent_request.id, userId: user.id, phoneLast4: phone.last(4) }.to_json)
    { sent: true, response: JSON.parse(raw) }
  rescue JSON::ParserError
    { sent: true, response: nil }
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
