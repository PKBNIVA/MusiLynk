# Rebuilds the sitemap into Rails.cache (Seo::Sitemap), hourly from cron and on demand when
# /sitemap.xml finds the cache empty (a fresh cache store, or the first deploy). Logs counts only.
class SitemapRefreshJob < ApplicationJob
  queue_as :scheduled

  def perform
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    result = Seo::Sitemap.refresh!
    Rails.cache.delete(SitemapsController::QUEUED_KEY)
    files = result.keys.count { _1.match?(/\A(sitemap|\d+)\z/) }
    Rails.logger.info({ event: "sitemap_refreshed", urls: result["urls"], files:, ms: ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round }.to_json)
  end
end
