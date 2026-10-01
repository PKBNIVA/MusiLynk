# GET /api/public/rates/:city — median/IQR session, show and day rates (INR) per directory role
# in one city, from real profile data only. Backs /rates/:city on the frontend.
class RatesController < ApplicationController
  CACHE_TTL = 1.hour
  INDEXABLE_MIN_ROLES_WITH_DATA = 3

  def show
    city_slug = params[:city].to_s.strip.downcase
    city_name = Seo::Pages.city_name(city_slug)
    return render_error("Unknown city.", :not_found) unless city_name

    expires_in CACHE_TTL, public: true
    body = Rails.cache.fetch("rates-page/v2/#{city_slug}", expires_in: CACHE_TTL) { build_payload(city_slug, city_name) }
    render json: body
  end

  private

  def build_payload(city_slug, city_name)
    # Numbers shown to visitors include the badged demo profiles; indexability counts organic ones only.
    summaries = Seo::Rates.for_city(city_name, include_demo: true)
    roles = summaries.map do |slug, summary|
      { slug:, label: Seo::Pages.role_label(slug), n: summary.n, hasData: summary.hasData,
        sessionRate: summary.sessionRate, showRate: summary.showRate, dayRate: summary.dayRate }
    end
    {
      city: { slug: city_slug, name: city_name },
      roles:,
      indexable: Seo::Rates.for_city(city_name).values.count(&:hasData) >= INDEXABLE_MIN_ROLES_WITH_DATA,
      updatedAt: Time.current.iso8601
    }
  end
end
