# Resolves the public frontend origin (no trailing slash) from ENV["FRONTEND_URL"], falling back
# to the production Vercel URL. Shared by anything that needs to build a canonical link back to
# the SPA (sitemap, share pages, notification emails, auth links).
class FrontendUrl
  PRODUCTION_FRONTEND_URL = "https://musilynk.vercel.app".freeze

  def self.base
    configured = ENV["FRONTEND_URL"].to_s.strip.sub(%r{/+\z}, "")
    return configured if configured.present?
    return "http://localhost:5173" unless Rails.env.production?

    Rails.logger.error({ event: "frontend_url_missing", fallback: PRODUCTION_FRONTEND_URL }.to_json)
    PRODUCTION_FRONTEND_URL
  end
end
