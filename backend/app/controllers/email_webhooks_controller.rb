# Brevo transactional webhook: hard/soft bounces, spam complaints, blocks and unsubscribes
# are recorded in EmailSuppression so MusiLynk stops emailing addresses that cannot or should
# not receive mail.
#
# Brevo does not sign webhook bodies, so the shared secret BREVO_WEBHOOK_SECRET must be sent
# with every call, in any one of:
#   * the URL:            https://<api>/api/email/webhook/brevo?token=<secret>
#   * basic auth:         any username, the secret as the password
#   * a bearer header:    Authorization: Bearer <secret>
# Without the variable the endpoint refuses everything (503), so it can never be open.
class EmailWebhooksController < ApplicationController
  MAX_EVENTS = 500

  def brevo
    secret = ENV["BREVO_WEBHOOK_SECRET"].to_s
    return render_error("Email webhook is not configured.", :service_unavailable, "WEBHOOK_NOT_CONFIGURED") if secret.blank?
    return render_error("Invalid webhook credentials.", :unauthorized, "INVALID_WEBHOOK_TOKEN") unless authorized?(secret)

    events = parsed_events
    return render_error("Invalid webhook payload.", :bad_request, "INVALID_PAYLOAD") if events.nil?

    results = Hash.new(0)
    events.first(MAX_EVENTS).each do |event|
      results[record(event)] += 1
    end
    Rails.logger.info({ event: "email_webhook_processed", provider: "brevo", **results }.to_json)
    render json: { ok: true, recorded: results[:recorded], duplicate: results[:duplicate], ignored: results[:ignored] }
  end

  private

  def authorized?(secret)
    candidates = [request.query_parameters["token"], bearer_token, basic_auth_password].compact
    # Compare every candidate (no early exit) so timing does not reveal which one was checked.
    candidates.map { |value| ActiveSupport::SecurityUtils.secure_compare(value.to_s, secret) }.any?
  end

  def bearer_token
    request.authorization.to_s[/\ABearer\s+(.+)\z/i, 1]
  end

  def basic_auth_password
    encoded = request.authorization.to_s[/\ABasic\s+(.+)\z/i, 1]
    return nil unless encoded

    Base64.decode64(encoded).split(":", 2).last
  end

  # Brevo sends one event per call, or an array when batching is turned on.
  def parsed_events
    body = JSON.parse(request.raw_post)
    list = body.is_a?(Array) ? body : [body]
    list.all?(Hash) ? list : nil
  rescue JSON::ParserError
    nil
  end

  def record(event)
    EmailSuppression.record!(email: event["email"], event: event["event"], message_id: event["message-id"].presence&.to_s&.first(255), at: event_time(event))
  end

  def event_time(event)
    ts = event["ts_event"] || event["ts_epoch"] || event["ts"]
    return Time.zone.at(ts.to_i / (ts.to_i > 99_999_999_999 ? 1000 : 1)) if ts.to_s.match?(/\A\d+\z/)

    Time.zone.parse(event["date"].to_s) || Time.current
  rescue ArgumentError
    Time.current
  end
end
