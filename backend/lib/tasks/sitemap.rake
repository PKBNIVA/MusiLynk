namespace :sitemap do
  desc "Build the sitemap into the cache if no build exists yet (pre-deploy step; never fails the deploy)."
  task warm: :environment do
    if Seo::Sitemap.last_good
      puts "sitemap:warm: a build is cached; nothing to do."
    else
      files = Seo::Sitemap.refresh!
      puts "sitemap:warm: built #{files['urls']} URLs."
    end
  rescue StandardError => error
    # A failed warm only means the first crawler request builds it (SitemapsController); the deploy goes on.
    warn "sitemap:warm: #{error.class}: #{error.message.first(200)}"
    ErrorReporter.capture(error, tags: { source: "sitemap_warm" })
  end
end
