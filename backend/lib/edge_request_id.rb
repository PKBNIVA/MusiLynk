# Carries the request id the edge already assigned into Rails, so one id names a request in
# Vercel's logs, Railway's logs, the API's JSON request line, the Sentry event and the
# `X-Request-Id` response header the browser reports back (src/app/lib/api.ts).
#
# Rails' ActionDispatch::RequestId reads `X-Request-Id` and makes one up when it is missing.
# Vercel's rewrites (vercel.json: the sitemap, share pages and the edge-cached public reads)
# send `x-vercel-id` instead, so when no `X-Request-Id` arrived this middleware copies the
# first edge id it finds into that header, normalised to what RequestId keeps (word
# characters, `-` and `@`; `::` between Vercel's regions becomes `-`).
class EdgeRequestId
  HEADER = "HTTP_X_REQUEST_ID".freeze
  EDGE_HEADERS = %w[HTTP_X_VERCEL_ID HTTP_X_RAILWAY_REQUEST_ID].freeze
  MAX_LENGTH = 255

  def initialize(app)
    @app = app
  end

  def call(env)
    if env[HEADER].to_s.strip.empty?
      edge = EDGE_HEADERS.map { env[_1].to_s.strip }.find(&:present?)
      env[HEADER] = self.class.normalize(edge) if edge
    end
    @app.call(env)
  end

  def self.normalize(value)
    value.to_s.strip.gsub(/[:\/\s]+/, "-").gsub(/[^\w\-@]/, "").squeeze("-").gsub(/\A-+|-+\z/, "").first(MAX_LENGTH)
  end
end
