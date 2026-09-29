# Top-level (outside /api) dynamic sitemap for search crawlers. See routes.rb.
class SitemapsController < ActionController::API
  MAX_URLS = 45_000

  STATIC_PAGES = [
    ["/", "daily"],
    ["/music-jobs", "daily"],
    ["/music-professionals", "daily"],
    ["/book-music", "daily"],
    ["/urgent", "weekly"],
    ["/join/hiring", "weekly"],
    ["/join/musician", "weekly"],
    ["/pricing", "weekly"],
    ["/guide", "weekly"],
    ["/about", "weekly"],
    ["/safety", "weekly"],
    ["/contact", "weekly"],
    ["/community-guidelines", "weekly"],
    ["/terms", "weekly"],
    ["/privacy", "weekly"]
  ].freeze

  def show
    xml = Rails.cache.fetch("sitemap/v1", expires_in: 1.hour) { build_xml }
    expires_in 1.hour, public: true
    render xml: xml, content_type: "application/xml"
  end

  private

  def build_xml
    base = FrontendUrl.base
    entries = []
    STATIC_PAGES.each { |path, freq| entries << { loc: "#{base}#{path}", changefreq: freq } }
    Job.published.find_each { |job| entries << { loc: "#{base}/opportunities/#{job.id}", lastmod: job.updated_at } }
    talent_scope.find_each { |user| entries << { loc: "#{base}/professionals/#{user.id}", lastmod: user.updated_at } }
    act_scope.find_each { |act| entries << { loc: "#{base}/acts/#{act.id}", lastmod: act.updated_at } }
    portfolio_scope.each { |portfolio| entries << { loc: "#{base}/p/#{portfolio.slug}", lastmod: portfolio.updated_at } }

    if entries.length > MAX_URLS
      Rails.logger.warn({ event: "sitemap_url_cap_exceeded", total: entries.length, cap: MAX_URLS }.to_json)
      entries = entries.first(MAX_URLS)
    end

    render_urlset(entries)
  end

  def talent_scope
    User.discoverable_talent
  end

  def act_scope
    Act.where(status: "active")
  end

  # Mirrors Portfolios#public_show's `publicly_readable?` check, without a per-row query when possible.
  def portfolio_scope
    Portfolio.with_owner.select(&:publicly_readable?)
  end

  def render_urlset(entries)
    io = +%(<?xml version="1.0" encoding="UTF-8"?>\n)
    io << %(<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n)
    entries.each do |entry|
      io << "  <url>\n"
      io << "    <loc>#{CGI.escapeHTML(entry[:loc])}</loc>\n"
      io << "    <lastmod>#{entry[:lastmod].utc.strftime('%Y-%m-%d')}</lastmod>\n" if entry[:lastmod]
      io << "    <changefreq>#{CGI.escapeHTML(entry[:changefreq])}</changefreq>\n" if entry[:changefreq]
      io << "  </url>\n"
    end
    io << "</urlset>\n"
    io
  end
end
