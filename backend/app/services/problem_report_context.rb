# The context a person agreed to attach to a problem report, reduced to an allow-list: release,
# browser/OS, viewport and the last few client error messages (scrubbed again here so a client
# that skipped its own scrubbing cannot store an email address, token or password). Anything else
# the client sends (cookies, storage, form contents) is dropped, never stored.
module ProblemReportContext
  MAX_ERRORS = 10
  MAX_ERROR_LENGTH = 200
  MAX_RAW_BYTES = 8_192
  TEXT_FIELDS = { "release" => 80, "browser" => 80, "os" => 80, "language" => 20 }.freeze

  module_function

  # raw: a JSON string (multipart request) or a Hash. role: the signed-in role, from the server.
  def build(raw, role:)
    data = parse(raw)
    out = {}
    TEXT_FIELDS.each do |key, limit|
      value = data[key]
      out[key] = clean(value, limit) if value.is_a?(String) && value.strip != ""
    end
    viewport = data["viewport"]
    if viewport.is_a?(Hash)
      width, height = %w[width height].map { Integer(viewport[_1], exception: false) }
      out["viewport"] = { "width" => width, "height" => height } if width&.between?(1, 20_000) && height&.between?(1, 20_000)
    end
    errors = Array(data["errors"]).first(MAX_ERRORS).filter_map { |message| clean(message, MAX_ERROR_LENGTH) if message.is_a?(String) && message.strip != "" }
    out["errors"] = errors if errors.any?
    out["role"] = role if role.present?
    out
  end

  def parse(raw)
    return raw.to_unsafe_h.stringify_keys if raw.respond_to?(:to_unsafe_h)
    return raw.stringify_keys if raw.is_a?(Hash)
    return {} unless raw.is_a?(String) && raw.bytesize <= MAX_RAW_BYTES

    parsed = JSON.parse(raw)
    parsed.is_a?(Hash) ? parsed : {}
  rescue JSON::ParserError
    {}
  end

  def clean(value, limit) = ErrorScrubber.scrub_string(value.to_s.gsub(/[[:cntrl:]]+/, " ").squish).first(limit)
end
