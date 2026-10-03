# CDN cache headers for the anonymous reads of public endpoints (directory listings, public
# profiles, the landing counters, the sitemap). Vercel's edge honours `s-maxage` on the
# same-origin `/api/public/*` rewrites (vercel.json), so a landing visitor's three calls are
# served from the edge once a minute instead of hitting Rails every time.
#
# Only an anonymous GET is ever marked public: the same URLs answer a signed-in person with
# saved/applied flags, applause, synthetic-QA visibility or admin reach, so those responses keep
# Rails' default `max-age=0, private, must-revalidate`. Every response, either way, says
# `Vary: Authorization`, so no cache (browser, edge or proxy) reuses an anonymous body for a
# bearer-token request. Lifetimes come from config/edge_cache.yml (docs/ops/edge-caching.md).
module PublicCaching
  extend ActiveSupport::Concern

  VARY_HEADER = "Authorization"

  private

  # Call once the body is known. Adds the shared-cache headers and a weak ETag of `etag` (the
  # rendered body, or the string it will be rendered from) when the caller is anonymous, and
  # answers 304 when the client's `If-None-Match` still matches. Returns true when the response
  # is complete (the 304), so controllers write `return if public_cache!(:listing, etag: json)`.
  def public_cache!(kind, etag:)
    vary_on(VARY_HEADER)
    return false unless publicly_cacheable?
    lifetime = EdgeCache.lifetime(kind)
    response.cache_control.merge!(public: true, stale_while_revalidate: lifetime.stale_while_revalidate, extras: ["s-maxage=#{lifetime.s_maxage}"])
    response.cache_control[:max_age] = lifetime.max_age if lifetime.max_age
    fresh_when(etag:, public: true)
    performed?
  end

  # GET or HEAD with no (valid) session. A controller outside ApplicationController (the sitemap)
  # has no sessions at all, so everything it serves is anonymous.
  def publicly_cacheable?
    return false unless request.get? || request.head?
    !respond_to?(:current_user, true) || current_user.nil?
  end

  def vary_on(header)
    current = response.headers["Vary"].to_s.split(",").map(&:strip).reject(&:empty?)
    response.headers["Vary"] = (current | [header]).join(", ")
  end
end
