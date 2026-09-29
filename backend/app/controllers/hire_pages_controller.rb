# GET /api/public/hire-pages/:role/:city — data for a role x city SEO landing page
# (/hire/:role/:city on the frontend). Role and city both come from the fixed lists in
# config/seo_pages.yml; anything else is a 404, the same way an unknown record would be.
class HirePagesController < ApplicationController
  CACHE_TTL = 1.hour
  INDEXABLE_MIN_PROFESSIONALS = 5
  POPULAR_LIMIT = 12

  # GET /api/public/hire-pages/popular-searches — the landing page's "Popular searches" block:
  # the highest-count role x city combinations, Mumbai's before any other city's (config/seo_pages.yml
  # lists Mumbai first), each with real professional counts so the links are never dead ends.
  def popular_searches
    expires_in CACHE_TTL, public: true
    render json: Rails.cache.fetch("hire-page/popular-searches/v1", expires_in: CACHE_TTL) { build_popular_searches }
  end

  def show
    role_slug = params[:role].to_s.strip.downcase
    city_slug = params[:city].to_s.strip.downcase
    role_label = Seo::Pages.role_label(role_slug)
    city_name = Seo::Pages.city_name(city_slug)
    return render_not_found unless role_label && city_name

    expires_in CACHE_TTL, public: true
    body = Rails.cache.fetch("hire-page/v2/#{role_slug}/#{city_slug}", expires_in: CACHE_TTL) do
      build_payload(role_slug, role_label, city_slug, city_name)
    end
    render json: body
  end

  private

  def build_popular_searches
    city_slugs = Seo::Pages.city_slugs.each_with_index.to_h
    combos = city_slugs.keys.flat_map do |city_slug|
      city_name = Seo::Pages.city_name(city_slug)
      Seo::Pages.roles.map do |role_slug, role_label|
        count = Seo::HireStats.counts_for(role_label, city_name)[:professionals]
        { role: { slug: role_slug, label: role_label }, city: { slug: city_slug, name: city_name }, count:,
          citySort: city_slugs.fetch(city_slug) }
      end
    end
    top = combos.select { _1[:count] >= INDEXABLE_MIN_PROFESSIONALS }
      .sort_by { |combo| [combo[:citySort], -combo[:count]] }.first(POPULAR_LIMIT)
    { items: top.map { _1.except(:citySort) } }
  end

  def render_not_found
    render_error("Unknown role or city.", :not_found)
  end

  def build_payload(role_slug, role_label, city_slug, city_name)
    counts = Seo::HireStats.counts_for(role_label, city_name)
    indexable = counts[:professionals] >= INDEXABLE_MIN_PROFESSIONALS
    rates = Seo::Rates.summary_for(role_label, city_name)
    {
      role: { slug: role_slug, label: role_label },
      city: { slug: city_slug, name: city_name },
      counts:,
      featured: Seo::HireStats.featured_for(role_label, city_name).map { public_profile(_1) },
      relatedRoles: related_roles(role_slug, city_name),
      nearbyCities: Seo::Pages.nearby_cities(city_slug).map { { slug: _1, name: Seo::Pages.city_name(_1) } },
      indexable:,
      ratesPath: "/rates/#{city_slug}",
      faq: faq_for(role_label, city_name, city_slug, rates)
    }
  end

  def related_roles(role_slug, city_name)
    Seo::Pages.sibling_roles(role_slug).map do |slug|
      label = Seo::Pages.role_label(slug)
      { slug:, label:, count: Seo::HireStats.counts_for(label, city_name)[:professionals] }
    end
  end

  def faq_for(role_label, city_name, city_slug, rates)
    role = role_label.downcase
    [
      { question: "How much does a session #{role} in #{city_name} charge?", answer: rate_answer(role, rates) },
      { question: "How fast can I book a #{role} in #{city_name}?",
        answer: "Most urgent requests on Verse get a first response within hours. Posting an urgent request reaches every " \
          "available #{role} in #{city_name} at once, instead of waiting on one message at a time." },
      { question: "Are #{role}s on Verse in #{city_name} verified?",
        answer: "Every profile shows real, reviewable work. A verified badge means Verse has confirmed that professional's " \
          "identity and track record — filter to verified #{role}s in #{city_name} to hire with more confidence." },
      { question: "What does it cost to hire a #{role} for a gig or event in #{city_name}?",
        answer: "Rates depend on the event, the professional's experience and how far ahead you book. See what verified and " \
          "unverified professionals in #{city_name} report at /rates/#{city_slug}." }
    ]
  end

  def rate_answer(role, rates)
    if rates.hasData && rates.sessionRate
      low = rates.sessionRate[:p25].round
      high = rates.sessionRate[:p75].round
      "Session #{role} rates reported on Verse typically run from #{format_inr(low)} to #{format_inr(high)} per session " \
        "(based on #{rates.sessionRate[:n]} profiles). Rates vary by experience and event; ask for a quote through Verse."
    else
      "Rates vary by experience and event; ask for a quote through Verse."
    end
  end

  def format_inr(amount)
    "₹#{amount.to_i.to_s.reverse.gsub(/(\d{3})(?=\d)/, '\1,').reverse}"
  end
end
