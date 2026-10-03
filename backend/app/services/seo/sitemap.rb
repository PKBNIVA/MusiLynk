# Builds the sitemap that SitemapsController serves. Too slow for a request (one COUNT per hire
# page, 390 at the time of writing, plus every portfolio; 33 s at 50k profiles), so
# SitemapRefreshJob builds it on a schedule into Rails.cache and the controller only reads it.
#
# Up to MAX_URLS URLs it is one <urlset> at /sitemap.xml. Past that, /sitemap.xml is a
# <sitemapindex> of /sitemaps/1.xml, /sitemaps/2.xml, ... of MAX_URLS each (the protocol allows
# 50,000), so no URL is dropped. Static, hire and rates pages come first, so they always sit in the
# first file.
module Seo
  module Sitemap
    MAX_URLS = 45_000
    CACHE_KEY = "sitemap/v3".freeze
    # The job runs hourly; three hours keeps serving the last build through a missed run or two.
    CACHE_TTL = 3.hours

    STATIC_PAGES = [
      ["/", "daily"], ["/music-jobs", "daily"], ["/music-professionals", "daily"], ["/book-music", "daily"],
      ["/urgent", "weekly"], ["/join/hiring", "weekly"], ["/join/musician", "weekly"], ["/pricing", "weekly"],
      ["/guide", "weekly"], ["/about", "weekly"], ["/safety", "weekly"], ["/contact", "weekly"],
      ["/community-guidelines", "weekly"], ["/terms", "weekly"], ["/privacy", "weekly"]
    ].freeze

    module_function

    # { "sitemap" => xml served at /sitemap.xml, "1" => xml at /sitemaps/1.xml, ... } (the numbered
    # files only when the URLs do not fit in one), plus "generatedAt" and "urls".
    def build(now: Time.current)
      base = FrontendUrl.base
      entries = page_entries(base) + record_entries(base, now)
      files = if entries.length <= MAX_URLS
        { "sitemap" => urlset(entries) }
      else
        parts = entries.each_slice(MAX_URLS).to_a
        { "sitemap" => sitemap_index(base, parts.length, now) }.merge(parts.each_with_index.to_h { |part, index| [(index + 1).to_s, urlset(part)] })
      end
      files.merge("generatedAt" => now.iso8601, "urls" => entries.length)
    end

    def refresh! = build.tap { Rails.cache.write(CACHE_KEY, _1, expires_in: CACHE_TTL) }

    def cached = Rails.cache.read(CACHE_KEY)

    def page_entries(base)
      STATIC_PAGES.map { |path, freq| { loc: "#{base}#{path}", changefreq: freq } } +
        indexable_hire_pages.map { |role_slug, city_slug| { loc: "#{base}/hire/#{role_slug}/#{city_slug}", changefreq: "weekly" } } +
        indexable_rates_pages.map { { loc: "#{base}/rates/#{_1}", changefreq: "weekly" } }
    end

    # pluck, not find_each: a sitemap only needs the id and the timestamp, not whole rows (job
    # descriptions and profile bios are the wide columns).
    def record_entries(base, now)
      job_scope(now).pluck("jobs.id", "jobs.updated_at").map { |id, at| { loc: "#{base}/opportunities/#{id}", lastmod: at } } +
        talent_scope.pluck("users.id", "users.updated_at").map { |id, at| { loc: "#{base}/professionals/#{id}", lastmod: at } } +
        act_scope.pluck("acts.id", "acts.updated_at").map { |id, at| { loc: "#{base}/acts/#{id}", lastmod: at } } +
        portfolio_scope.map { { loc: "#{base}/p/#{_1.slug}", lastmod: _1.updated_at } }
    end

    # Demo and QA accounts are shown to people browsing the site but never to search engines:
    # every scope below is limited to organic (non-synthetic) owners.
    # Open postings only: one whose application deadline has passed is a JobPosting past its validThrough.
    def job_scope(now)
      Job.published.joins(:employer).merge(User.organic).where("jobs.application_deadline IS NULL OR jobs.application_deadline >= ?", now)
    end

    def talent_scope = User.discoverable_talent.organic

    def act_scope = Act.where(status: "active").joins(:owner).merge(User.organic)

    # Mirrors Portfolios#public_show's `publicly_readable?` check, without a per-row query when possible.
    def portfolio_scope
      synthetic_owners = User.where.not(synthetic_batch: nil).pluck(:id).to_set
      Portfolio.with_owner.select { _1.publicly_readable? && !synthetic_owners.include?(_1.library_user_id) }
    end

    # Role x city hire pages worth crawling: only the ones with enough real profiles to be worth
    # ranking (HirePagesController's own threshold). One COUNT per page, which is why this runs in a job.
    def indexable_hire_pages
      Seo::Pages.city_slugs.flat_map do |city_slug|
        city_name = Seo::Pages.city_name(city_slug)
        Seo::Pages.roles.filter_map do |role_slug, role_label|
          [role_slug, city_slug] if Seo::HireStats.professionals_in(role_label, city_name) >= HirePagesController::INDEXABLE_MIN_PROFESSIONALS
        end
      end
    end

    def indexable_rates_pages
      Seo::Pages.city_slugs.select do |city_slug|
        Seo::Rates.for_city(Seo::Pages.city_name(city_slug)).values.count(&:hasData) >= RatesController::INDEXABLE_MIN_ROLES_WITH_DATA
      end
    end

    def urlset(entries)
      io = +%(<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n)
      entries.each do |entry|
        io << "  <url>\n    <loc>#{CGI.escapeHTML(entry[:loc])}</loc>\n"
        io << "    <lastmod>#{entry[:lastmod].utc.strftime('%Y-%m-%d')}</lastmod>\n" if entry[:lastmod]
        io << "    <changefreq>#{CGI.escapeHTML(entry[:changefreq])}</changefreq>\n" if entry[:changefreq]
        io << "  </url>\n"
      end
      io << "</urlset>\n"
    end

    def sitemap_index(base, count, now)
      io = +%(<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n)
      (1..count).each { io << "  <sitemap>\n    <loc>#{CGI.escapeHTML("#{base}/sitemaps/#{_1}.xml")}</loc>\n    <lastmod>#{now.utc.strftime('%Y-%m-%d')}</lastmod>\n  </sitemap>\n" }
      io << "</sitemapindex>\n"
    end
  end
end
