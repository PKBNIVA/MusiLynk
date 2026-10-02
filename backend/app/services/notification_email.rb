# Content for notification emails (bookings, applications, messages). Rendering is
# kept separate from the token-link templates in EmailDelivery; the rendered email is
# handed to EmailDelivery.deliver_rendered, which owns the provider integrations.
#
# Every interpolated value is user-supplied (names, titles), so HTML is escaped and
# message bodies are never part of an email.
class NotificationEmail
  UNSUBSCRIBE_PURPOSE = :notification_email_unsubscribe

  TEMPLATES = {
    "booking_enquiry" => {
      subject: ->(p) { "New booking enquiry for #{p['act']}" },
      heading: ->(_) { "New booking enquiry" },
      copy: ->(p) { "#{p['name']} sent an enquiry for #{p['act']}. Review the brief and reply with a quote." },
      action: "View bookings", path: "/bookings"
    },
    "booking_status" => {
      subject: ->(p) { "Booking update: #{p['act']}" },
      heading: ->(_) { "Your booking was updated" },
      copy: ->(p) {
        base = "The booking for #{p['act']} is now #{p['status'].to_s.downcase.tr('_', ' ')}."
        p["status"] == "accepted" ? "#{base} If the act cancels, tell us and we'll help you find a replacement through MusiLynk's urgent requests." : base
      },
      action: "View bookings", path: "/bookings"
    },
    "application_status" => {
      subject: ->(p) { "Application update: #{p['job']}" },
      heading: ->(_) { "Your application was updated" },
      copy: ->(p) { "Your application for #{p['job']} is now marked as #{p['status'].to_s.tr('_', ' ')}." },
      action: "View applications", path: "/applications"
    },
    "new_message" => {
      subject: ->(p) { "New message from #{p['name']} on MusiLynk" },
      heading: ->(_) { "You have a new message" },
      copy: ->(p) { p["job"].present? ? "#{p['name']} sent you a message about #{p['job']}." : "#{p['name']} sent you a message." },
      action: "Read and reply", path: "/messages"
    },
    "urgent_request_alert" => {
      subject: ->(p) { "Urgent: #{p['role']} needed in #{p['city']}" },
      heading: ->(_) { "A hirer needs someone fast" },
      copy: ->(p) {
        starts = IndianFormat.date_time_from_iso(p["startAt"])
        base = "#{p['title']} in #{p['city']}#{", #{starts}" if starts}. If you're free, respond before someone else does."
        reasons = Array(p["reasons"])
        reasons.present? ? "#{base} Why you: #{reasons.join(' · ')}." : base
      },
      action: "See the request", path: "/urgent"
    },
    "early_access_granted" => {
      subject: ->(p) { "Your Early Access Pro is active until #{p['until']}" },
      heading: ->(_) { "Your Early Access Pro is active" },
      copy: ->(p) { "No card needed. Pro features are unlocked on MusiLynk until #{p['until']}. We'll email you 7 days and 1 day before it ends." },
      action: "Open your billing page", path: "/billing"
    },
    "invoice_issued" => {
      subject: ->(p) { "Your MusiLynk #{p['kind'] || 'invoice'} #{p['number']}" },
      heading: ->(_) { "Your invoice is ready" },
      copy: ->(p) { "We received your payment of #{p['amount']}. Your #{p['kind'] || 'invoice'} #{p['number']} is ready to view, print or save as a PDF." },
      action: "View your invoice", path: "/billing"
    },
    # trial/renewal/early-access lifecycle reminders (BillingRemindersJob). Their `path` is
    # already the full one-click cancel URL (see NotificationEmail.render), not a relative path.
    "trial_ending_soon" => {
      subject: ->(_) { "Your Pro trial ends in 3 days" },
      heading: ->(_) { "Your free trial ends in 3 days" },
      copy: ->(p) { "Your Pro trial ends on #{p['endsOn']}. Unless you cancel before then, your first charge happens automatically and your plan continues as Pro." },
      action: "Manage your plan"
    },
    "plan_renewing_soon" => {
      subject: ->(_) { "Your MusiLynk plan renews in 3 days" },
      heading: ->(_) { "Your plan renews in 3 days" },
      copy: ->(p) do
        credit = p["creditDays"].to_i.positive? ? " Your #{p['creditDays']} bonus days from referrals are recorded on your account." : ""
        "Your #{p['planName']} #{p['interval'] == 'annual' ? 'annual' : 'monthly'} plan renews on #{p['renewsOn']} for #{p['amount']}#{p['interval'] == 'annual' ? ' a year' : ' a month'}. Cancel any time before then if you don't want to be charged.#{credit}"
      end,
      action: "Cancel or manage billing"
    },
    "early_access_ending" => {
      subject: ->(p) { "Your Early Access Pro ends in #{p['days']}" },
      heading: ->(p) { "Your Early Access Pro ends in #{p['days']}" },
      copy: ->(p) { "Your free run of Pro on MusiLynk ends on #{p['endsOn']}. After that your account moves to the Free plan unless you subscribe." },
      action: "Manage your plan"
    },
    "urgent_request_expiry_warning" => {
      subject: ->(p) { "Your request expires in 6 hours" },
      heading: ->(_) { "Your request expires in 6 hours" },
      copy: ->(p) { "\"#{p['title']}\" expires in 6 hours. If it is done, mark it filled or close it so musicians stop seeing it." },
      links: ->(p) { [["Mark it filled", p["filledLink"]], ["Close it", p["closeLink"]]] },
      action: "Open your request", path: "/urgent"
    },
    "urgent_request_expired" => {
      subject: ->(p) { "#{p['title']} has expired" },
      heading: ->(_) { "This request has expired" },
      copy: ->(p) { "\"#{p['title']}\" has expired. The hirer did not confirm a booking through MusiLynk." },
      action: "See urgent requests", path: "/urgent"
    },
    "verification_more_proof" => {
      subject: ->(_) { "Add more proof to get verified faster" },
      heading: ->(_) { "Add more proof to get verified faster" },
      copy: ->(p) { "We received your verification request and need a little more to go on. What would help: #{p['tips']}." },
      action: "Update your profile", path: "/profile"
    },
    "job_deadline_closed" => {
      subject: ->(p) { "#{p['title']} closed at its deadline" },
      heading: ->(_) { "Your opportunity closed at its deadline" },
      copy: ->(p) { "#{p['title']} closed at its deadline. Reopen it with a new date if you're still hiring." },
      action: "View your opportunities", path: ""
    },
    "review_prompt" => {
      subject: ->(p) { p["reminder"] == "true" ? "Still time to review #{p['name']}" : "How did it go with #{p['name']}?" },
      heading: ->(p) { p["reminder"] == "true" ? "A quick reminder" : (p["path"].to_s.include?("/reviews") ? "Leave a review" : "How did it go?") },
      # Only musicians have a review form; a hirer's link is their dashboard, so the button says so.
      copy: ->(p) { p["path"].to_s.include?("/reviews") ? "Leave a quick review for #{p['name']}. It helps other musicians and hirers on MusiLynk." : "Your work with #{p['name']} is done. Open your dashboard to see how it went and what to do next." },
      action: ->(p) { p["path"].to_s.include?("/reviews") ? "Write a review" : "Open your dashboard" }, path: "/reviews"
    },
    # PaymentsOpenEmails: one email to each member who ticked "Email me when payments open". Its
    # `path` is the full /pricing URL (it is the same page for musicians and hirers, so it must
    # not get a workspace prefix).
    "payments_open" => {
      subject: ->(_) { "Payments are now open on MusiLynk" },
      heading: ->(_) { "Payments are now open on MusiLynk" },
      copy: ->(_) { "You asked us to tell you when payments open. You can now pay and get paid safely through MusiLynk. See the plans and what each one costs." },
      action: "See pricing"
    },
    "act_invite" => {
      subject: ->(p) { "#{p['name']} invited you to join #{p['act']}" },
      heading: ->(_) { "You've been invited to join a band" },
      copy: ->(p) { "#{p['name']} invited you to join #{p['act']} as #{p['role']}. You are only added if you accept, and you can decline." },
      action: "See your invites", path: "/acts?tab=invites"
    },
    "verification_approved" => {
      subject: ->(_) { "You're verified on MusiLynk" },
      heading: ->(_) { "You're verified on MusiLynk" },
      copy: ->(_) { "Your profile now shows the Verified badge. Share your profile on Instagram or WhatsApp to reach more hirers." },
      action: "Share your badge", path: "/profile"
    }
  }.freeze

  # Only verified addresses are emailed (an unverified address may not belong to the account
  # holder), never to someone who turned notification emails off, and never to an address
  # the provider reported as bounced, complaining or unsubscribed (EmailSuppression).
  # Transactional emails (sign-in codes, verification, password reset) do not go through this class.
  # `category` narrows delivery to one of Profile::EMAIL_PREFERENCE_CATEGORIES (digest,
  # lifecycle, requests, product) for the lifecycle/digest/milestone emails that offer that
  # granular opt-out (LifecycleMailer). Left nil for the transactional templates in this
  # class, which only the master switch (email_notifications) can turn off.
  def self.deliverable_to?(user, category: nil)
    EmailDelivery.configured? && user.synthetic_batch.nil? && user.email.present? && user.email_verified? && user.status == "active" && opted_in?(user) &&
      (category.nil? || user.profile.nil? || user.profile.email_category_enabled?(category)) &&
      !EmailSuppression.blocks_notifications?(user.email) && !EmailDelivery.skip_reserved?(user.email)
  end

  # Users without a profile row (admins) keep the column default: opted in.
  def self.opted_in?(user) = user.profile.nil? || user.profile.email_notifications?

  # Returns { subject:, html:, text:, headers: }. Raises KeyError for an unknown template.
  def self.render(template, params, user)
    spec = TEMPLATES.fetch(template)
    params = params.to_h.stringify_keys
    path = params["path"].presence || spec[:path]
    # A lifecycle reminder's `path` is already the full one-click cancel URL
    # (BillingRemindersJob), never a relative in-app path — use it as-is.
    link = path.to_s.start_with?("http") ? path : "#{frontend_url}#{in_workspace(path, user)}"
    subject = spec[:subject].call(params).squish.first(150)
    heading = spec[:heading].call(params)
    copy = spec[:copy].call(params)
    token = CGI.escape(unsubscribe_token(user))
    unsubscribe_page = "#{frontend_url}/unsubscribe?token=#{token}"
    action = spec[:action].respond_to?(:call) ? spec[:action].call(params) : spec[:action]
    links = spec[:links] ? spec[:links].call(params).select { |_, url| url.to_s.start_with?("http") } : []
    secondary_text = links.map { |label, url| "#{label}: #{url}" }.join("\n")
    {
      subject:, html: html(heading:, copy:, action:, link:, unsubscribe: unsubscribe_page, links:),
      text: [Brand::NAME, heading, copy, "#{action}: #{link}", secondary_text.presence, "Turn off these emails: #{unsubscribe_page}"].compact.join("\n\n"),
      headers: unsubscribe_headers(token, unsubscribe_page)
    }
  end

  # Signed, purpose-scoped and non-expiring, so an old email's link keeps working. It can
  # only turn notification emails off for the user it names.
  def self.unsubscribe_token(user) = unsubscribe_verifier.generate(user.id, purpose: UNSUBSCRIBE_PURPOSE)

  def self.user_for_unsubscribe_token(token)
    id = unsubscribe_verifier.verified(token.to_s, purpose: UNSUBSCRIBE_PURPOSE)
    id.is_a?(String) ? User.find_by(id:) : nil
  rescue StandardError
    nil
  end

  def self.unsubscribe_verifier = Rails.application.message_verifier("notification-email-unsubscribe")

  # RFC 8058 one-click needs an HTTPS endpoint that accepts POST, i.e. the API (API_HOST).
  # Without API_HOST only the web page is advertised.
  def self.unsubscribe_headers(token, unsubscribe_page)
    api_host = ENV["API_HOST"].to_s.strip.sub(%r{/+\z}, "")
    return { "List-Unsubscribe" => "<#{unsubscribe_page}>" } if api_host.blank?

    { "List-Unsubscribe" => "<#{api_host}/api/notifications/unsubscribe?token=#{token}>", "List-Unsubscribe-Post" => "List-Unsubscribe=One-Click" }
  end

  # The account settings page (sign-in methods, email preferences) in the person's own workspace.
  def self.settings_link(user) = "#{frontend_url}#{workspace(user)}/settings"

  def self.workspace(user) = user.role == "employer" ? "/employer" : "/jobseeker"

  # A role-relative path ("/urgent") gets the recipient's workspace prefix; a path that already
  # carries it ("/jobseeker/reviews?..." from Notifier) is left alone, so it is never doubled.
  def self.in_workspace(path, user)
    prefix = workspace(user)
    path = path.to_s
    path == prefix || path.start_with?("#{prefix}/", "#{prefix}?") ? path : "#{prefix}#{path}"
  end

  def self.frontend_url = FrontendUrl.base

  def self.html(heading:, copy:, action:, link:, unsubscribe:, links: [])
    h = ERB::Util.method(:html_escape)
    # Secondary text links (never a second button), e.g. the one-tap actions on an expiry warning.
    extra = links.map { |label, url| %(<a href="#{h.call(url)}" style="color:#a78bfa">#{h.call(label)}</a>) }.join(" · ")
    extra = %(<p style="margin:16px 0 0;font-size:14px">#{extra}</p>) if extra.present?
    <<~HTML.squish
      #{EmailDelivery.head_html(copy)}<div style="max-width:560px;margin:0 auto;padding:40px 24px">#{EmailDelivery.brand_header_html}<h1 style="font-size:26px;margin:28px 0 12px">#{h.call(heading)}</h1><p style="color:#cbd5e1;line-height:1.6">#{h.call(copy)}</p>#{EmailDelivery.button_html(action, link)}#{extra}<p style="margin-top:28px;color:#94a3b8;font-size:13px">You are receiving this because of activity on your MusiLynk account. <a href="#{h.call(unsubscribe)}" style="color:#a78bfa">Turn off these emails</a>.</p></div></body></html>
    HTML
  end

  private_class_method :html
end
