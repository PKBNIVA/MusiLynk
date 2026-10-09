# GET /api/public/config — the business settings the frontend reads instead of keeping constants
# (PublicConfig). Computed from in-memory Settings (no queries) and, for anonymous callers, kept
# at the CDN edge per config/edge_cache.yml `config` (PublicCaching). Signed-in callers get the
# same anonymous body (their own feature flags come from GET /api/me), marked private.
class PublicConfigController < ApplicationController
  def show
    json = PublicConfig.payload.to_json
    return if public_cache!(:config, etag: json)
    render json: json
  end
end
