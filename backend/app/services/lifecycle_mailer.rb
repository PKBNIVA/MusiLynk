# Content for the retention email lifecycle: onboarding sequence steps, milestones, and
# the weekly digest (LifecycleEmailsJob, WeeklyDigestJob, and the milestone sends in
# Notifier). Rendering is kept separate from delivery (LifecycleEmailDeliveryJob owns the
# provider call), the same split NotificationEmail/EmailDelivery use.
#
# Every email here carries a "Manage emails" link to the same signed, no-sign-in-required
# unsubscribe page NotificationEmail uses (/unsubscribe?token=...), which now also shows the
# four granular toggles. Copy is short, one CTA, no exclamation marks, Indian English, ₹.
class LifecycleMailer
  # One entry per onboarding-sequence step and per milestone. `category` is one of
  # Profile::EMAIL_PREFERENCE_CATEGORIES; LifecycleEmailDeliveryJob checks it before sending.
  STEPS = {
    # Musician (jobseeker) onboarding sequence.
    "musician_day1_first_link" => {
      category: "lifecycle", subject: "Add your first work link",
      heading: "Show people what you sound like",
      copy: ->(_) { "A profile with one work sample gets far more replies than an empty one. Add a track, a video, or a link to a set." },
      action: "Add a work link", path: "/jobseeker/portfolio"
    },
    "musician_day3_verified_badge" => {
      category: "lifecycle", subject: "Get your Verified badge",
      heading: "Stand out with a Verified badge",
      copy: ->(_) { "Verified profiles are trusted faster by hirers. It takes a couple of minutes to request." },
      action: "Get verified", path: "/jobseeker/verification"
    },
    "musician_day5_set_availability" => {
      category: "lifecycle", subject: "Set your availability so hirers can find you",
      heading: "Let hirers know when you're free",
      copy: ->(_) { "Set your availability so requests near you can reach you at the right time." },
      action: "Set availability", path: "/jobseeker/availability"
    },
    "musician_day10_add_rates" => {
      category: "lifecycle", subject: "Add your rates",
      heading: "Add your rates",
      copy: ->(_) { "Profiles with rates get more enquiries. Add yours so hirers know what to expect." },
      action: "Add your rates", path: "/jobseeker/profile"
    },
    "musician_day21_inactive_requests" => {
      category: "lifecycle", subject: ->(p) { "#{p['count']} new requests near you this week" },
      heading: ->(p) { "#{p['count']} new requests near you this week" },
      copy: ->(p) { "Hirers in #{p['city']} posted #{p['count']} urgent requests this week. Take a look before someone else responds." },
      action: "See urgent requests", path: "/jobseeker/urgent"
    },
    # Hirer (employer) onboarding sequence.
    "hirer_day1_post_or_urgent" => {
      category: "lifecycle", subject: "Post what you need",
      heading: "Post what you need — or send an urgent request",
      copy: ->(_) { "Tell musicians what you're looking for, or send an urgent request if you need someone fast." },
      action: "Post a listing", path: "/employer/jobs/new"
    },
    "hirer_day3_meet_verified" => {
      category: "lifecycle", subject: ->(p) { "Meet verified #{p['role']} players in #{p['city']}" },
      heading: ->(p) { "Meet verified #{p['role']} players in #{p['city']}" },
      copy: ->(_) { "Here are a few verified musicians who might be a fit." },
      action: "Browse musicians", path: "/employer/discover"
    },
    "hirer_day7_listing_applicants" => {
      category: "lifecycle", subject: ->(p) { "Your listing has #{p['count']} applicants" },
      heading: ->(p) { "Your listing has #{p['count']} applicants" },
      copy: ->(p) { "#{p['title']} has new applicants waiting for a look." },
      action: "Review applicants", path: "/employer/applicants"
    },
    "hirer_day14_inactive_response_time" => {
      category: "lifecycle", subject: ->(p) { "Musicians in #{p['city']} are answering fast" },
      heading: ->(p) { "Musicians in #{p['city']} are answering within #{p['hours']} hours" },
      copy: ->(_) { "If you have a gig to fill, an urgent request usually gets a reply quickly." },
      action: "Send an urgent request", path: "/employer/urgent/new"
    },
    # Milestones (instant, via Notifier).
    "milestone_hirer_first_application" => {
      category: "product", subject: "You received your first application",
      heading: "Your first application is in",
      copy: ->(p) { "#{p['candidate']} applied to #{p['job']}. Take a look." },
      action: "Review applicants", path: "/employer/applicants"
    },
    "milestone_musician_first_response" => {
      category: "product", subject: "You responded in %{minutes} minutes",
      heading: ->(p) { "You responded in #{p['minutes']} minutes" },
      copy: ->(_) { "Fast responders get chosen more. Keep an eye on urgent requests near you." },
      action: "See urgent requests", path: "/jobseeker/urgent"
    },
    "milestone_profile_100_views" => {
      category: "product", subject: "Your profile has been viewed 100 times",
      heading: "Your profile passed 100 views",
      copy: ->(_) { "People are finding you on Verse. A complete profile with rates and a work sample keeps that going." },
      action: "View your profile", path: "/jobseeker/profile"
    },
    "milestone_hirer_5th_filled_request" => {
      category: "product", subject: "You've filled 5 urgent requests on Verse",
      heading: "5 requests filled through Verse",
      copy: ->(_) { "You've filled 5 urgent requests through Verse. Thanks for using it to find people fast." },
      action: "Post another request", path: "/employer/urgent/new"
    }
  }.freeze

  def self.step_category(key) = STEPS.fetch(key)[:category]

  # Returns { subject:, html:, text: } for a sequence step or milestone. Raises KeyError
  # for an unknown key.
  def self.render_step(key, params, user)
    spec = STEPS.fetch(key)
    params = params.to_h.stringify_keys
    subject = call_or_value(spec[:subject], params).to_s.squish.first(150)
    heading = call_or_value(spec[:heading], params)
    copy = call_or_value(spec[:copy], params)
    link = "#{NotificationEmail.frontend_url}#{NotificationEmail.workspace(user)}#{spec[:path]}"
    render_content(heading:, copy:, action: spec[:action], link:, user:)
  end

  # Returns { subject:, html:, text: } for a weekly digest. `sections` is an ordered array
  # of { heading:, items: [{ text:, link: }], footnote: } hashes built by WeeklyDigest.
  # Skips (returns nil) when every section is empty, per the spec's skip rule.
  def self.render_digest(sections, user, subject:)
    sections = sections.reject { |s| s[:items].blank? && s[:footnote].blank? }
    return nil if sections.empty?

    { subject: subject.squish.first(150), html: digest_html(sections, user), text: digest_text(sections, user) }
  end

  def self.call_or_value(value, params) = value.respond_to?(:call) ? value.call(params) : value

  def self.render_content(heading:, copy:, action:, link:, user:)
    { subject: heading, html: html(heading:, copy:, action:, link:, user:), text: text(heading:, copy:, action:, link:, user:) }
  end

  def self.manage_emails_url(user) = "#{NotificationEmail.frontend_url}/unsubscribe?token=#{CGI.escape(NotificationEmail.unsubscribe_token(user))}"

  def self.footer_text(user) = "Manage which Verse emails you get: #{manage_emails_url(user)}"

  def self.footer_html(user)
    h = ERB::Util.method(:html_escape)
    %(<p style="margin-top:28px;color:#94a3b8;font-size:13px">You are receiving this because of activity on your Verse account. <a href="#{h.call(manage_emails_url(user))}" style="color:#a78bfa">Manage emails</a>.</p>)
  end

  def self.html(heading:, copy:, action:, link:, user:)
    h = ERB::Util.method(:html_escape)
    <<~HTML.squish
      <!doctype html><html><body style="margin:0;background:#0b0b12;color:#f8fafc;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 24px"><div style="font-size:22px;font-weight:800;color:#a78bfa">VERSE</div><h1 style="font-size:26px;margin:28px 0 12px">#{h.call(heading)}</h1><p style="color:#cbd5e1;line-height:1.6">#{h.call(copy)}</p><a href="#{h.call(link)}" style="display:inline-block;margin-top:18px;padding:13px 20px;border-radius:12px;background:#7c3aed;color:white;text-decoration:none;font-weight:700">#{h.call(action)}</a>#{footer_html(user)}</div></body></html>
    HTML
  end

  def self.text(heading:, copy:, action:, link:, user:)
    "#{heading}\n\n#{copy}\n\n#{action}: #{link}\n\n#{footer_text(user)}"
  end

  def self.digest_html(sections, user)
    h = ERB::Util.method(:html_escape)
    body = sections.map do |section|
      items = Array(section[:items]).map { |i| %(<li style="margin-bottom:8px"><a href="#{h.call(i[:link])}" style="color:#e2e8f0;text-decoration:none">#{h.call(i[:text])}</a></li>) }.join
      list = items.present? ? %(<ul style="padding-left:18px;margin:8px 0">#{items}</ul>) : ""
      note = section[:footnote].present? ? %(<p style="color:#cbd5e1;margin:8px 0">#{h.call(section[:footnote])}</p>) : ""
      %(<h2 style="font-size:17px;margin:22px 0 6px;color:#f8fafc">#{h.call(section[:heading])}</h2>#{note}#{list})
    end.join
    <<~HTML.squish
      <!doctype html><html><body style="margin:0;background:#0b0b12;color:#f8fafc;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 24px"><div style="font-size:22px;font-weight:800;color:#a78bfa">VERSE</div><h1 style="font-size:24px;margin:28px 0 4px">This week on Verse</h1>#{body}#{footer_html(user)}</div></body></html>
    HTML
  end

  def self.digest_text(sections, user)
    body = sections.map do |section|
      lines = Array(section[:items]).map { |i| "- #{i[:text]}: #{i[:link]}" }
      [section[:heading], section[:footnote], *lines].compact.join("\n")
    end.join("\n\n")
    "This week on Verse\n\n#{body}\n\n#{footer_text(user)}"
  end
  private_class_method :html, :digest_html, :digest_text, :footer_html
end
