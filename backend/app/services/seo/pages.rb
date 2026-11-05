# The fixed role/city lists behind the /hire/:role/:city and /rates/:city pages
# (config/seo_pages.yml). Keeping them in one small YAML file — rather than mixing them into
# search_taxonomy.yml — means the SEO surface can grow city by city without touching the roles
# people filter and post with.
module Seo
  module Pages
    PATH = Rails.root.join("config/seo_pages.yml")

    module_function

    # { "drummer" => "Drummer", ... }, in the file's order.
    def roles = data[:roles]

    # { "mumbai" => "Mumbai", ... }, in the file's order (Mumbai first).
    def cities = data[:cities]

    def role_label(slug) = roles[slug.to_s.strip.downcase]
    def city_name(slug) = cities[slug.to_s.strip.downcase]

    def role_slugs = roles.keys
    def city_slugs = cities.keys

    # Up to `count` other role slugs, cycling from just after `slug` so the picks are
    # deterministic and stable across requests.
    def sibling_roles(slug, count: 4)
      slugs = role_slugs
      index = slugs.index(slug.to_s.downcase) || 0
      others = slugs.rotate(index + 1).reject { _1 == slug.to_s.downcase }
      others.first(count)
    end

    # Up to `count` other city slugs, same rotation rule as sibling_roles.
    def nearby_cities(slug, count: 3)
      slugs = city_slugs
      index = slugs.index(slug.to_s.downcase) || 0
      others = slugs.rotate(index + 1).reject { _1 == slug.to_s.downcase }
      others.first(count)
    end

    def data
      @data ||= begin
        raw = Settings.load(:seo_pages, symbolize: false)
        { roles: raw.fetch("roles").freeze, cities: raw.fetch("cities").freeze }.freeze
      end
    end
  end
end
