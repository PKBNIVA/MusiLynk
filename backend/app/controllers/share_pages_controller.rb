# Minimal server-rendered HTML for social/link-preview crawlers (see vercel.json rewrites that
# route those user agents here instead of the SPA). No JS, no CSS beyond a tiny inline block.
class SharePagesController < ActionController::API
  EMPLOYMENT_TYPES = {
    "full-time" => "FULL_TIME", "full time" => "FULL_TIME",
    "part-time" => "PART_TIME", "part time" => "PART_TIME",
    "contract" => "CONTRACTOR", "contractor" => "CONTRACTOR", "freelance" => "CONTRACTOR", "project-based" => "CONTRACTOR",
    "temporary" => "TEMPORARY", "temp" => "TEMPORARY"
  }.freeze

  def job
    job = Job.published.joins(:employer).merge(User.organic).find_by(id: params[:id])
    return render_default(:not_found) unless job

    description = plain_text(job.description)
    render_html(
      title: "#{job.title} at #{job.company} | Verse",
      description: truncate(description),
      canonical_path: "/opportunities/#{job.id}",
      og_type: "article",
      image: og_image("opportunity", job.id),
      json_ld: job_json_ld(job, description)
    )
  end

  def professional
    user = User.discoverable_talent.organic.find_by(id: params[:id])
    return render_default(:not_found) unless user

    profile = user.profile
    bio = plain_text(profile&.bio)
    render_html(
      title: "#{user.name} | Verse",
      description: truncate(bio.presence || profile&.headline.to_s),
      canonical_path: "/professionals/#{user.id}",
      og_type: "profile",
      image: og_image("professional", user.id),
      json_ld: person_json_ld(user, profile, bio)
    )
  end

  def act
    act = Act.where(status: "active").joins(:owner).merge(User.organic).find_by(id: params[:id])
    return render_default(:not_found) unless act

    bio = plain_text(act.bio)
    render_html(
      title: "#{act.name} | Verse",
      description: truncate(bio),
      canonical_path: "/acts/#{act.id}",
      og_type: "website",
      image: og_image("act", act.id),
      json_ld: act_json_ld(act, bio)
    )
  end

  def portfolio
    portfolio = Portfolio.with_owner.find_by(slug: params[:slug].to_s)
    return render_default(:not_found) unless portfolio&.publicly_readable? && !synthetic_owner?(portfolio)

    bio = plain_text(portfolio.effective["bio"])
    image = portfolio.members.first&.first&.thumbnail_url.presence
    render_html(
      title: "#{portfolio.title} | Verse",
      description: truncate(bio.presence || portfolio.headline.to_s),
      canonical_path: "/p/#{portfolio.slug}",
      og_type: "website",
      image:,
      json_ld: portfolio_json_ld(portfolio, bio)
    )
  end

  private

  def base = FrontendUrl.base

  # The 1200x630 card drawn per share by the Vercel function api/og.ts (reached through the
  # /api/og/:type/:id rewrite in vercel.json); an unknown id gets its default card.
  def og_image(type, id) = "#{base}/api/og/#{type}/#{ERB::Util.url_encode(id)}.png"

  # Demo and QA accounts never get a crawlable preview page (they are excluded from the sitemap too).
  def synthetic_owner?(portfolio) = User.where(id: portfolio.library_user_id).where.not(synthetic_batch: nil).exists?

  def plain_text(value)
    return "" if value.blank?
    ActionController::Base.helpers.strip_tags(value.to_s.gsub(/[*_`#>\[\]]/, "").gsub(/\r?\n+/, " ")).squish
  end

  def truncate(text, length = 157)
    text = text.to_s
    return text if text.length <= 160
    "#{text[0, length]}..."
  end

  def job_json_ld(job, description)
    employment_type = EMPLOYMENT_TYPES[job.kind.to_s.strip.downcase] || "OTHER"
    ld = {
      "@context" => "https://schema.org",
      "@type" => "JobPosting",
      "title" => job.title,
      "description" => description,
      "datePosted" => (job.published_at || job.created_at).iso8601,
      "employmentType" => employment_type,
      "hiringOrganization" => { "@type" => "Organization", "name" => job.company },
      "directApply" => true,
      "identifier" => { "@type" => "PropertyValue", "name" => "Verse", "value" => job.id }
    }
    ld["validThrough"] = job.application_deadline.iso8601 if job.application_deadline.present?
    if job.workplace == "remote"
      ld["jobLocationType"] = "TELECOMMUTE"
    else
      ld["jobLocation"] = { "@type" => "Place", "address" => { "@type" => "PostalAddress", "addressLocality" => job.location, "addressCountry" => "IN" } }
    end
    if job.compensation_min.present? || job.compensation_max.present?
      ld["baseSalary"] = {
        "@type" => "MonetaryAmount", "currency" => job.currency.presence || "INR",
        "value" => { "@type" => "QuantitativeValue", "minValue" => job.compensation_min, "maxValue" => job.compensation_max, "unitText" => (job.compensation_period.presence || "MONTH").to_s.upcase }
      }
    end
    ld
  end

  def person_json_ld(user, profile, bio)
    ld = { "@context" => "https://schema.org", "@type" => "Person", "name" => user.name, "url" => "#{base}/professionals/#{user.id}" }
    ld["jobTitle"] = profile.headline if profile&.headline.present?
    ld["address"] = { "@type" => "PostalAddress", "addressLocality" => profile.location } if profile&.location.present?
    ld["description"] = bio if bio.present?
    ld
  end

  def act_json_ld(act, bio)
    ld = { "@context" => "https://schema.org", "@type" => "MusicGroup", "name" => act.name, "description" => bio, "url" => "#{base}/acts/#{act.id}" }
    ld["genre"] = act.genres if act.genres.present?
    ld
  end

  def portfolio_json_ld(portfolio, bio)
    person = { "@type" => "Person", "name" => portfolio.title }
    person["description"] = bio if bio.present?
    { "@context" => "https://schema.org", "@type" => "ProfilePage", "mainEntity" => person, "url" => "#{base}/p/#{portfolio.slug}" }
  end

  def render_default(status)
    expires_in 10.minutes, public: true
    render html: page_html(
      title: "Verse — Find a verified musician for your session or gig within 24 hours",
      description: "Verse connects musicians, bands and venues for gigs, sessions and hires.",
      canonical: base,
      og_type: "website",
      image: "#{base}/og-default.png",
      json_ld: nil
    ).html_safe, status:, content_type: "text/html"
  end

  # Google's crawlers are rewritten to these pages too (vercel.json) so the JobPosting/Person
  # JSON-LD reaches them; a 0-second refresh to the canonical URL would look like a self-redirect.
  GOOGLE_CRAWLER = /Googlebot|Google-InspectionTool|GoogleOther/i

  def google_crawler? = GOOGLE_CRAWLER.match?(request.user_agent.to_s)

  def render_html(title:, description:, canonical_path:, og_type:, image:, json_ld:)
    canonical = "#{base}#{canonical_path}"
    resolved_image = image.presence || "#{base}/og-default.png"
    resolved_image = "#{base}#{resolved_image}" unless resolved_image.start_with?("http")
    expires_in 10.minutes, public: true
    response.headers["Vary"] = "User-Agent"
    render html: page_html(title:, description:, canonical:, og_type:, image: resolved_image, json_ld:, refresh: !google_crawler?).html_safe,
      content_type: "text/html"
  end

  def page_html(title:, description:, canonical:, og_type:, image:, json_ld:, refresh: true)
    esc = CGI.method(:escapeHTML)
    refresh_tag = refresh ? %(<meta http-equiv="refresh" content="0; url=#{esc.call(canonical)}">) : ""
    ld_script = json_ld ? %(<script type="application/ld+json">#{json_ld.to_json.gsub('</', '<\/')}</script>) : ""
    <<~HTML
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>#{esc.call(title)}</title>
        <meta name="description" content="#{esc.call(description)}">
        <link rel="canonical" href="#{esc.call(canonical)}">
        <meta property="og:type" content="#{esc.call(og_type)}">
        <meta property="og:site_name" content="Verse">
        <meta property="og:title" content="#{esc.call(title)}">
        <meta property="og:description" content="#{esc.call(description)}">
        <meta property="og:url" content="#{esc.call(canonical)}">
        <meta property="og:image" content="#{esc.call(image)}">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="#{esc.call(title)}">
        <meta name="twitter:description" content="#{esc.call(description)}">
        <meta name="twitter:image" content="#{esc.call(image)}">
        #{refresh_tag}
        #{ld_script}
        <style>body{background:#0b0b12;color:#f4f4f6;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}
        a{color:#8b8bff;font-size:1.1rem}</style>
      </head>
      <body>
        <div>
          <p>#{esc.call(title)}</p>
          <a href="#{esc.call(canonical)}">Open on Verse</a>
        </div>
      </body>
      </html>
    HTML
  end
end
