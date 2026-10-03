# Top-level (outside /api) sitemap for search crawlers. See routes.rb.
#
# Serves what SitemapRefreshJob built into the cache (Seo::Sitemap). Never an error page for a
# crawler: an expired build is served from the last-good copy while a rebuild is queued, and only
# a brand-new cache store (nothing ever written; `sitemap:warm` runs before each deploy to avoid it)
# makes a request build the sitemap inline, once, under a lock.
class SitemapsController < ActionController::API
  # Shared CDN headers for public reads (app/controllers/concerns/public_caching.rb), once that
  # concern exists; until then the sitemap keeps its plain one-hour public cache.
  include PublicCaching if defined?(PublicCaching)

  QUEUED_KEY = "sitemap/v3/queued".freeze
  QUEUED_TTL = 10.minutes

  # GET /sitemap.xml: a <urlset>, or a <sitemapindex> of /sitemaps/N.xml when there are too many URLs.
  def show = serve("sitemap")

  # GET /sitemaps/:part.xml
  def part = serve(params[:part].to_s)

  private

  def serve(name)
    xml = name.match?(/\A(sitemap|\d+)\z/) ? files[name] : nil
    return head(:not_found) unless xml
    return if cache_headers!(xml)
    render xml:, content_type: "application/xml"
  end

  def files
    current = Seo::Sitemap.cached
    return current if current
    stale = Seo::Sitemap.last_good
    return Seo::Sitemap.build_once! unless stale
    queue_refresh
    stale
  end

  # Expired build: one rebuild per QUEUED_TTL, however many crawlers ask meanwhile.
  def queue_refresh
    SitemapRefreshJob.perform_later if Rails.cache.write(QUEUED_KEY, true, expires_in: QUEUED_TTL, unless_exist: true)
  end

  # True when the response is already complete (a 304 from PublicCaching).
  def cache_headers!(xml)
    return public_cache!(:sitemap, etag: xml) if respond_to?(:public_cache!, true)
    expires_in 1.hour, public: true
    false
  end
end
