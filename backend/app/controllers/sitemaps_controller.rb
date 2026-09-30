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
    Job.published.joins(:employer).merge(User.organic).find_each { |job| entries << { loc: "#{base}/opportunities/#{job.id}", lastmod: job.updated_at } }
    talent_scope.find_each { |user| entries << { loc: "#{base}/professionals/#{user.id}", lastmod: user.updated_at } }
    act_scope.find_each { |act| entries << { loc: "#{base}/acts/#{act.id}", lastmod: act.updated_at } }
    portfolio_scope.each { |portfolio| entries << { loc: "#{base}/p/#{portfolio.slug}", lastmod: portfolio.updated_at } }
    indexable_hire_pages.each { |role_slug, city_slug| entries << { loc: "#{base}/hire/#{role_slug}/#{city_slug}", changefreq: "weekly" } }
    indexable_rates_pages.each { |city_slug| entries << { loc: "#{base}/rates/#{city_slug}", changefreq: "weekly" } }

    if entries.length > MAX_URLS
      Rails.logger.warn({ event: "sitemap_url_cap_exceeded", total: entries.length, cap: MAX_URLS }.to_json)
      entries = entries.first(MAX_URLS)
    end

    render_urlset(entries)
  end

  # Demo and QA accounts are shown to people browsing the site but never to search engines:
  # every scope below is limited to organic (non-synthetic) owners.
  def talent_scope
    User.discoverable_talent.organic
  end

  def act_scope
    Act.where(status: "active").joins(:owner).merge(User.organic)
  end

  # Mirrors Portfolios#public_show's `publicly_readable?` check, without a per-row query when possible.
  def portfolio_scope
    synthetic_owners = User.where.not(synthetic_batch: nil).pluck(:id).to_set
    Portfolio.with_owner.select { _1.publicly_readable? && !synthetic_owners.include?(_1.library_user_id) }
  end

  # Role x city hire pages worth crawling: only the ones with enough real profiles to be worth
  # ranking (HirePagesController's own threshold). Cached inside this action's 1-hour cache, so
  # the underlying counts are computed once an hour, same as a single hire page.
  def indexable_hire_pages
    Seo::Pages.city_slugs.flat_map do |city_slug|
      city_name = Seo::Pages.city_name(city_slug)
      Seo::Pages.roles.filter_map do |role_slug, role_label|
        count = Seo::HireStats.counts_for(role_label, city_name)[:professionals]
        [role_slug, city_slug] if count >= HirePagesController::INDEXABLE_MIN_PROFESSIONALS
      end
    end
  end

  def indexable_rates_pages
    Seo::Pages.city_slugs.select do |city_slug|
      city_name = Seo::Pages.city_name(city_slug)
      Seo::Rates.for_city(city_name).values.count(&:hasData) >= RatesController::INDEXABLE_MIN_ROLES_WITH_DATA
    end
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
