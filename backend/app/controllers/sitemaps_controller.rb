# Top-level (outside /api) sitemap for search crawlers. See routes.rb.
#
# Only reads what SitemapRefreshJob built into the cache (Seo::Sitemap): building it takes tens of
# seconds and hundreds of queries, far too long for a request. When the cache is empty the job is
# queued (once per QUEUED_TTL) and crawlers get 503 with Retry-After, which they treat as "come back".
class SitemapsController < ActionController::API
  QUEUED_KEY = "sitemap/v3/queued".freeze
  QUEUED_TTL = 10.minutes
  RETRY_AFTER = 5.minutes

  # GET /sitemap.xml: a <urlset>, or a <sitemapindex> of /sitemaps/N.xml when there are too many URLs.
  def show = serve("sitemap")

  # GET /sitemaps/:part.xml
  def part = serve(params[:part].to_s)

  private

  def serve(name)
    files = Seo::Sitemap.cached
    return unavailable unless files
    xml = name.match?(/\A(sitemap|\d+)\z/) ? files[name] : nil
    return head(:not_found) unless xml
    expires_in 1.hour, public: true
    render xml:, content_type: "application/xml"
  end

  def unavailable
    SitemapRefreshJob.perform_later if Rails.cache.write(QUEUED_KEY, true, expires_in: QUEUED_TTL, unless_exist: true)
    response.headers["Retry-After"] = RETRY_AFTER.to_i.to_s
    head :service_unavailable
  end
end
