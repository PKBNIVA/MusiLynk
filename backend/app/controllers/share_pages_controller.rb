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
      description: truncate(bio.presence || profile&.headline.presence || "#{user.name} on Verse: see their work, rates and availability, then book or message them."),
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
      description: truncate(bio.presence || act.tagline.presence || "#{act.name} on Verse: see the lineup, sample fees and availability, then request a quote."),
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
      description: truncate(bio.presence || portfolio.headline.presence || "#{portfolio.title} on Verse: a musician portfolio with work samples and links."),
      canonical_path: "/p/#{portfolio.slug}",
      og_type: "website",
      image:,
      json_ld: portfolio_json_ld(portfolio, bio)
    )
  end

  private

  def base = FrontendUrl.base

  # The per-share 1200x630 card URL (/api/og/:type/:id). Drawn by the Vercel function api/og/[type]/[id].ts,
  # which redirects to the static /og-default.png when it cannot render a card.
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

  # schema.org baseSalary.value.unitText only takes HOUR, DAY, WEEK, MONTH or YEAR; Verse's per-session,
  # per-show and per-project periods have no equivalent, so those jobs publish no baseSalary at all
  # (an invalid unitText makes Google drop the whole posting from rich results).
  SALARY_UNITS = { "hour" => "HOUR", "day" => "DAY", "week" => "WEEK", "month" => "MONTH", "year" => "YEAR" }.freeze

  def base_salary(job)
    return unless job.compensation_min.present? || job.compensation_max.present?
    period = job.compensation_period.to_s.strip.downcase.presence || "month"
    unit = SALARY_UNITS[period]
    return unless unit
    value = { "@type" => "QuantitativeValue", "minValue" => job.compensation_min, "maxValue" => job.compensation_max, "unitText" => unit }.compact
    { "@type" => "MonetaryAmount", "currency" => job.currency.presence || "INR", "value" => value }
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
      # Google requires applicantLocationRequirements alongside TELECOMMUTE.
      ld["jobLocationType"] = "TELECOMMUTE"
      ld["applicantLocationRequirements"] = { "@type" => "Country", "name" => "IN" }
    else
      ld["jobLocation"] = { "@type" => "Place", "address" => { "@type" => "PostalAddress", "addressLocality" => job.location, "addressCountry" => "IN" }.compact }
    end
    salary = base_salary(job)
    ld["baseSalary"] = salary if salary
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
      json_ld: nil,
      robots: "noindex"
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

  def page_html(title:, description:, canonical:, og_type:, image:, json_ld:, refresh: true, robots: nil)
    esc = CGI.method(:escapeHTML)
    refresh_tag = refresh ? %(<meta http-equiv="refresh" content="0; url=#{esc.call(canonical)}">) : ""
    # Google reads this page as the document (vercel.json sends it here), so the description is body text too,
    # not only a meta tag.
    description_html = description.present? ? %(<p>#{esc.call(description)}</p>) : ""
    robots_tag = robots ? %(<meta name="robots" content="#{esc.call(robots)}">) : ""
    ld_script = json_ld ? %(<script type="application/ld+json">#{json_ld.to_json.gsub('</', '<\/')}</script>) : ""
    <<~HTML
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>#{esc.call(title)}</title>
        <meta name="description" content="#{esc.call(description)}">
        <link rel="canonical" href="#{esc.call(canonical)}">
        #{robots_tag}
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
        a{color:#8b8bff;font-size:1.1rem}h1{font-size:1.5rem}</style>
      </head>
      <body>
        <main>
          <h1>#{esc.call(title)}</h1>
          #{description_html}
          <a href="#{esc.call(canonical)}">Open on Verse</a>
        </main>
      </body>
      </html>
    HTML
  end
end
