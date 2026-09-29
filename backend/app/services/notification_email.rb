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
        base = "The booking for #{p['act']} is now #{p['status']}."
        p["status"] == "accepted" ? "#{base} If the act cancels, tell us and we'll help you find a replacement through Verse's urgent requests." : base
      },
      action: "View bookings", path: "/bookings"
    },
    "application_status" => {
      subject: ->(p) { "Application update: #{p['job']}" },
      heading: ->(_) { "Your application was updated" },
      copy: ->(p) { "Your application for #{p['job']} is now #{p['status']}." },
      action: "View applications", path: "/applications"
    },
    "new_message" => {
      subject: ->(p) { "New message from #{p['name']} on Verse" },
      heading: ->(_) { "You have a new message" },
      copy: ->(p) { p["job"].present? ? "#{p['name']} sent you a message about #{p['job']}." : "#{p['name']} sent you a message." },
      action: "Read and reply", path: "/messages"
    },
    "urgent_request_alert" => {
      subject: ->(p) { "Urgent: #{p['role']} needed in #{p['city']}" },
      heading: ->(_) { "A hirer needs someone fast" },
      copy: ->(p) {
        base = "#{p['title']} in #{p['city']}. If you're free, respond in one tap before someone else does."
        reasons = Array(p["reasons"])
        reasons.present? ? "#{base} Why you: #{reasons.join(' · ')}." : base
      },
      action: "See the request", path: "/jobseeker/urgent"
    },
    "early_access_granted" => {
      subject: ->(p) { "Your Early Access Pro is active until #{p['until']}" },
      heading: ->(_) { "Your Early Access Pro is active" },
      copy: ->(p) { "No card needed. Pro features are unlocked on Verse until #{p['until']}. We'll email you 7 days and 1 day before it ends." },
      action: "Open your billing page", path: "/employer/billing"
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
      subject: ->(_) { "Your Verse plan renews in 3 days" },
      heading: ->(_) { "Your plan renews in 3 days" },
      copy: ->(p) { "Your #{p['planName']} plan renews on #{p['renewsOn']} for #{p['amount']}. Cancel any time before then if you don't want to be charged." },
      action: "Cancel or manage billing"
    },
    "early_access_ending" => {
      subject: ->(p) { "Your Early Access Pro ends in #{p['days']}" },
      heading: ->(p) { "Your Early Access Pro ends in #{p['days']}" },
      copy: ->(p) { "Your free run of Pro on Verse ends on #{p['endsOn']}. After that your account moves to the Free plan unless you subscribe." },
      action: "Manage your plan"
    },
    "urgent_request_expiry_warning" => {
      subject: ->(p) { "Your request expires in 6 hours" },
      heading: ->(_) { "Your request expires in 6 hours" },
      copy: ->(p) { "\"#{p['title']}\" expires in 6 hours — mark it filled or close it. Mark filled: #{p['filledLink']} Close: #{p['closeLink']}" },
      action: "Open your request", path: "/jobseeker/urgent"
    },
    "urgent_request_expired" => {
      subject: ->(p) { "This request has expired" },
      heading: ->(_) { "This request has expired" },
      copy: ->(p) { "\"#{p['title']}\" has expired. The hirer didn't confirm a booking through Verse." },
      action: "See urgent requests", path: "/jobseeker/urgent"
    },
    "verification_more_proof" => {
      subject: ->(_) { "Add more proof to get verified faster" },
      heading: ->(_) { "Add more proof to get verified faster" },
      copy: ->(p) { "We received your verification request and need a little more to go on. What would help: #{p['tips']}." },
      action: "Update your profile", path: "/profile"
    },
    "job_deadline_closed" => {
      subject: ->(p) { "Your listing for #{p['title']} closed" },
      heading: ->(_) { "Your listing closed at its deadline" },
      copy: ->(p) { "Your listing for #{p['title']} closed at its deadline. Reopen with a new date if you're still hiring." },
      action: "View your listings", path: "/hiring"
    }
  }.freeze

  # Only verified addresses are emailed (an unverified address may not belong to the account
  # holder), never to someone who turned notification emails off, and never to an address
  # the provider reported as bounced, complaining or unsubscribed (EmailSuppression).
  # Transactional emails (sign-in codes, verification, password reset) do not go through this class.
  def self.deliverable_to?(user)
    EmailDelivery.configured? && user.email.present? && user.email_verified? && user.status == "active" && opted_in?(user) &&
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
    link = path.to_s.start_with?("http") ? path : "#{frontend_url}#{workspace(user)}#{path}"
    subject = spec[:subject].call(params).squish.first(150)
    heading = spec[:heading].call(params)
    copy = spec[:copy].call(params)
    token = CGI.escape(unsubscribe_token(user))
    unsubscribe_page = "#{frontend_url}/unsubscribe?token=#{token}"
    {
      subject:, html: html(heading:, copy:, action: spec[:action], link:, unsubscribe: unsubscribe_page),
      text: "#{heading}\n\n#{copy}\n\n#{link}\n\nTurn off these emails: #{unsubscribe_page}",
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

  def self.workspace(user) = user.role == "employer" ? "/employer" : "/jobseeker"

  def self.frontend_url = FrontendUrl.base

  def self.html(heading:, copy:, action:, link:, unsubscribe:)
    h = ERB::Util.method(:html_escape)
    <<~HTML.squish
      <!doctype html><html><body style="margin:0;background:#0b0b12;color:#f8fafc;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 24px"><div style="font-size:22px;font-weight:800;color:#a78bfa">VERSE</div><h1 style="font-size:26px;margin:28px 0 12px">#{h.call(heading)}</h1><p style="color:#cbd5e1;line-height:1.6">#{h.call(copy)}</p><a href="#{h.call(link)}" style="display:inline-block;margin-top:18px;padding:13px 20px;border-radius:12px;background:#7c3aed;color:white;text-decoration:none;font-weight:700">#{h.call(action)}</a><p style="margin-top:28px;color:#94a3b8;font-size:13px">You are receiving this because of activity on your Verse account. <a href="#{h.call(unsubscribe)}" style="color:#a78bfa">Turn off these emails</a>.</p></div></body></html>
    HTML
  end

  private_class_method :html
end
