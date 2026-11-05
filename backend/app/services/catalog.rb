# config/catalog.yml through Settings: the fixed catalogue lists CatalogController#taxonomy serves
# (act/event/engagement types, role categories, instruments) and the launch-city list.
module Catalog
  module_function

  def config = Settings.load(:catalog)

  def opportunity_kinds = config.fetch(:opportunity_kinds).map(&:to_s)
  def workplaces = config.fetch(:workplaces).map(&:to_s)
  def currencies = config.fetch(:currencies).map(&:to_s)
  def act_types = config.fetch(:act_types).map(&:to_s)
  def event_types = config.fetch(:event_types).map(&:to_s)
  def engagement_types = config.fetch(:engagement_types).map(&:to_s)
  def role_categories = config.fetch(:role_categories)
  def instruments = config.fetch(:instruments).map(&:to_s)
  def launch_cities = config.fetch(:launch_cities).map(&:to_s)

  # The lists the frontend mirrors (GET /api/public/config `catalog`): the SEO city/role lists
  # (config/seo_pages.yml) plus the launch cities.
  def public_json
    { launchCities: launch_cities,
      cities: Seo::Pages.cities.map { |slug, name| { slug:, name: } },
      hireRoles: Seo::Pages.roles.map { |slug, label| { slug:, label: } } }
  end
end
