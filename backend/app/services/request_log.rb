# The one JSON line each API request writes (config/initializers/lograge.rb). Lograge gathers
# method, path (query string already dropped), controller/action, status, duration and the
# db/view split; this module adds what Railway and Sentry need to correlate a line with a
# person's report or an error event, and makes sure nothing personal gets in:
#
#   requestId   the X-Request-Id the client saw (EdgeRequestId: Vercel's id when it fronted the call)
#   userHash    a keyed hash of the signed-in user's id, so one person's requests can be followed
#               in the logs without the id itself ever appearing there (never for anonymous calls)
#   dbQueries   SQL statements run by the request
#   slow        true when the request took at least ApplicationController.slow_request_ms
#   error       the exception class only, for a 500; messages can quote record values
#
# No parameters are logged, no headers, no IPs. See docs/ops/observability.md.
module RequestLog
  EVENT = "http_request".freeze
  HASH_LENGTH = 16

  module_function

  # Called by lograge from the controller once the action has run (append_info_to_payload).
  # Rails has reset the SQL counters by then, so the query count comes from the event instead.
  def payload(controller)
    user = controller.instance_variable_get(:@current_user)
    { requestId: controller.request.request_id, userHash: (user_hash(user.id) if user) }.compact
  end

  # Called by lograge with the process_action event (Rails puts queries_count in its payload).
  def options(event)
    line = { dbQueries: event.payload[:queries_count] }.compact
    line[:slow] = true if event.duration >= ApplicationController.slow_request_ms
    # Rails already put status 500 in the payload, so lograge adds nothing about the exception
    # itself; its class (never the message) is worth a column.
    line[:error] = event.payload[:exception].first if event.payload[:exception]
    line
  end

  # HMAC of the id under a key derived from the app secret: stable across requests and deploys
  # (so a person's requests correlate), not reversible to the id without the secret.
  def user_hash(id)
    OpenSSL::HMAC.hexdigest("SHA256", hash_key, id.to_s).first(HASH_LENGTH)
  end

  def hash_key
    @hash_key ||= Rails.application.key_generator.generate_key("request-log-user-hash", 32)
  end

  # lograge formatter: one JSON object per line, event first, exception class only.
  def format(data)
    line = { event: EVENT }.merge(data)
    line[:error] = line[:error].to_s.split(":", 2).first if line.key?(:error)
    line.delete(:format)
    line.to_json
  end
end
