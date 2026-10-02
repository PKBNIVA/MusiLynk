class EmailDelivery
  TEMPLATES = {
    "reset_password" => {
      subject: "Reset your Verse password",
      heading: "Reset your password",
      copy: "Use the secure link below to choose a new password. The link expires in two hours.",
      action: "Reset password"
    },
    "verify_email" => {
      subject: "Verify your Verse email",
      heading: "Verify your email",
      copy: "Confirm this email address to secure your Verse account.",
      action: "Verify email"
    },
    # data: { code: }. Deliberately no link: a code-only email cannot be used
    # by link scanners or from a forwarded message preview.
    "sign_in_code" => {
      subject: "Your Verse sign-in code",
      heading: "Your sign-in code",
      copy: "Enter this code on Verse to continue. It expires in 10 minutes and can be used once. Verse will never ask you for this code by phone or chat.",
      action: nil
    },
    # data: { code: }. Sent to the address an admin wants to switch their account to.
    "admin_email_change" => {
      subject: "Confirm your new Verse admin email",
      heading: "Confirm your new admin email",
      copy: "Enter this code on the Verse admin site to move your admin account to this address. It expires in 10 minutes and can be used once.",
      action: nil,
      footer: "If you didn't request this, ignore this email: nothing changes without the code. If you are a Verse admin and did not start this, change your admin password now."
    },
    # data: { detail: new address }. Sent to the previous address once the change is done.
    "admin_email_changed" => {
      subject: "Your Verse admin email was changed",
      heading: "Admin email changed",
      copy: "The email address for your Verse admin account was just changed to:",
      action: nil,
      notice: true,
      footer: "If you made this change, nothing else is needed. If you did not, sign in at the admin site right away and change your password, or contact the site owner."
    },
    # data: { code: }. Sent to the address an account holder wants to switch their account to.
    "account_email_change" => {
      subject: "Confirm your new Verse email",
      heading: "Confirm your new email",
      copy: "Enter this code on Verse to move your account to this address. It expires in 10 minutes and can be used once.",
      action: nil,
      footer: "If you didn't request this, ignore this email: nothing changes without the code. If you did not start this, change your Verse password now."
    },
    # data: { link: sign-in methods page }. Sent when Google sign-in is linked to an
    # existing account by matching a verified email (GoogleSignIn#signin!).
    "google_connected" => {
      subject: "Google sign-in was added to your Verse account",
      heading: "Google sign-in was added",
      copy: "You can now sign in to Verse with Google. Manage your sign-in methods any time from your account settings.",
      action: "Manage sign-in methods",
      footer: "If you did not do this, sign in and remove it from your sign-in methods, or contact support."
    },
    # data: { detail: new address }. Sent to the previous address once the change is done.
    "account_email_changed" => {
      subject: "Your Verse email was changed",
      heading: "Email changed",
      copy: "The email address for your Verse account was just changed to:",
      action: nil,
      notice: true,
      footer: "If you made this change, nothing else is needed. If you did not, sign in right away and change your password, or contact support."
    },
    # data: { detail: the account email }. Sent when a code-only or Google account sets its first
    # password (AccountController#change_password).
    "account_password_set" => {
      subject: "A password was added to your Verse account",
      heading: "Password added",
      copy: "A password was just added to your Verse account, so you can now also sign in with it. The account is:",
      action: nil,
      notice: true,
      footer: "If you made this change, nothing else is needed. If you did not, sign in right away with an emailed code and change your password, or contact support."
    },
    # data: { detail: the account email }. Sent when the password set before the address was confirmed
    # is removed (User#reclaim_unverified_credentials!).
    "account_password_removed" => {
      subject: "We removed a password from your Verse account",
      heading: "Password removed",
      copy: "For your security we removed the password that was set before you confirmed this address. You can set a new one any time from Settings, or sign in with an emailed code. The account is:",
      action: nil,
      notice: true,
      footer: "If you did not just sign in to Verse, contact support."
    },
    # data: { link:, name: }. Sent to the invitee's address; they may not have a Verse account yet.
    "vouch_invite" => {
      subject: "You were vouched for on Verse",
      heading: ->(d) { "#{d[:name]} vouched for you on Verse" },
      copy: ->(d) { "#{d[:name]} vouched for you on Verse. A vouch helps hirers trust your profile. Use the button below to join." },
      action: "Join Verse",
      # The invitee may have no account, so "your Verse account" and "cannot be turned off" do not apply.
      footer: "You are getting this one email because someone you know named you on Verse. If you do not know them, you can safely ignore it: nothing happens unless you join.",
      service_note: false
    },
    # data: { link:, name: (inviter), act:, role: }. Sent to an address that may have no Verse account yet.
    "act_invite" => {
      subject: "You were invited to join a band on Verse",
      heading: ->(d) { "#{d[:name]} invited you to join #{d[:act]}" },
      copy: ->(d) { "#{d[:name]} invited you to join #{d[:act]} as #{d[:role]}. Use the button to see the invite, sign in or join Verse, and accept or decline. The link works once and expires in 7 days." },
      action: "See the invite",
      footer: "You are getting this one email because someone invited you to their band on Verse. If you do not know them, ignore it: you are only added if you accept.",
      service_note: false
    }
  }.freeze
  DEFAULT_FOOTER = "If you did not request this, you can safely ignore this email.".freeze
  # Security and account emails cannot be switched off, so they carry no unsubscribe link; they
  # say why instead. The notification, lifecycle and digest emails (NotificationEmail,
  # LifecycleMailer) carry an unsubscribe / manage-emails link.
  SERVICE_NOTE = "This is a service email about your Verse account, so it cannot be turned off.".freeze

  # The brand header every email starts with: the V mark and the name. Inline styles only;
  # mail clients ignore style sheets.
  def self.brand_header_html
    %(<div style="font-size:0;line-height:0"><span style="display:inline-block;width:32px;height:32px;line-height:32px;border-radius:10px;background:#7c3aed;color:#ffffff;text-align:center;font-size:18px;font-weight:800;vertical-align:middle">V</span><span style="display:inline-block;margin-left:10px;font-size:22px;line-height:32px;font-weight:800;color:#a78bfa;vertical-align:middle">Verse</span></div>)
  end

  # The opening of <head> every email shares: charset and a mobile viewport, so 375px phones
  # do not scale a 560px layout down. `preheader` is the hidden line inbox lists show after the subject.
  def self.head_html(preheader)
    hidden = %(<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">#{ERB::Util.html_escape(preheader.to_s.squish.truncate(110))}</div>)
    %(<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#0b0b12;color:#f8fafc;font-family:Arial,sans-serif">#{hidden})
  end

  # The one primary button of an email (a link, styled as a button).
  def self.button_html(label, url)
    %(<a href="#{ERB::Util.html_escape(url)}" style="display:inline-block;margin-top:18px;padding:13px 20px;border-radius:12px;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:700">#{ERB::Util.html_escape(label)}</a>)
  end

  # Returns a result hash. Network and configuration errors are reported as an
  # unsuccessful delivery unless raise_errors is true (used by EmailDeliveryJob
  # so it can retry transient failures).
  def self.call(to:, template:, data:, raise_errors: false)
    return { delivered: false, reason: "Recipient unavailable" } if to.blank?
    return { delivered: false, reason: "Recipient suppressed" } if EmailSuppression.blocks_all?(to)
    return { delivered: false, reason: "Reserved address" } if skip_reserved?(to)
    return deliver_with_brevo(to:, template:, data:) if brevo_configured?
    return deliver_with_resend(to:, template:, data:) if ENV["RESEND_API_KEY"].present?

    webhook = ENV["EMAIL_DELIVERY_WEBHOOK"]
    return { delivered: false, reason: "Email provider not configured" } if webhook.blank?
    response = Faraday.post(webhook) do |request|
      request.headers["Content-Type"] = "application/json"
      request.headers["Authorization"] = "Bearer #{ENV['EMAIL_DELIVERY_TOKEN']}" if ENV["EMAIL_DELIVERY_TOKEN"].present?
      request.body = { to:, template:, data: }.to_json
      request.options.open_timeout = 5
      request.options.timeout = 10
    end
    log_rejection("webhook", template, response)
    { delivered: response.success?, status: response.status }
  rescue StandardError => error
    raise if raise_errors
    Rails.logger.error("email delivery failed: #{error.class}")
    ErrorReporter.capture(error, tags: { source: "email_delivery_failed", template: })
    { delivered: false, reason: "delivery error" }
  end

  def self.provider
    return "brevo" if brevo_configured?
    return "resend" if ENV["RESEND_API_KEY"].present?
    "webhook" if ENV["EMAIL_DELIVERY_WEBHOOK"].present?
  end

  def self.configured? = provider.present?

  # Top-level domains reserved by RFC 2606/6761 plus common internal ones: mail sent there
  # can never arrive (the seeded admin@verse.local, synthetic qa+…@example.invalid accounts).
  RESERVED_TLDS = %w[local localhost invalid test example internal].freeze

  def self.reserved_address?(email)
    domain = email.to_s.strip.downcase.split("@", 2)[1].to_s.delete_suffix(".")
    domain.present? && RESERVED_TLDS.include?(domain.split(".").last)
  end

  # Real providers (Brevo, Resend) are never asked to send to a reserved address: each attempt
  # would hard-bounce and hurt the sending domain's reputation. The webhook provider is local
  # QA plumbing and still receives them.
  def self.skip_reserved?(email) = %w[brevo resend].include?(provider) && reserved_address?(email)

  def self.brevo_configured?
    ENV["BREVO_API_KEY"].present? && ENV["BREVO_SENDER_EMAIL"].present?
  end

  def self.deliver_with_brevo(to:, template:, data:)
    content = TEMPLATES.fetch(template) { raise ArgumentError, "Unknown email template" }
    response = Faraday.post("https://api.brevo.com/v3/smtp/email") do |request|
      request.headers["Content-Type"] = "application/json"
      request.headers["Accept"] = "application/json"
      request.headers["api-key"] = ENV.fetch("BREVO_API_KEY")
      request.body = {
        sender: { name: ENV.fetch("BREVO_SENDER_NAME", "Verse"), email: ENV.fetch("BREVO_SENDER_EMAIL") },
        to: [{ email: to }], subject: content[:subject],
        htmlContent: email_html(content:, data:),
        textContent: email_text(content:, data:)
      }.to_json
      request.options.open_timeout = 5
      request.options.timeout = 10
    end
    log_rejection("brevo", template, response)
    { delivered: response.success?, status: response.status, provider: "brevo" }
  end

  def self.deliver_with_resend(to:, template:, data:)
    content = TEMPLATES.fetch(template) { raise ArgumentError, "Unknown email template" }
    response = Faraday.post("https://api.resend.com/emails") do |request|
      request.headers["Content-Type"] = "application/json"
      request.headers["Authorization"] = "Bearer #{ENV.fetch('RESEND_API_KEY')}"
      request.body = {
        from: ENV.fetch("EMAIL_FROM"), to: [to], subject: content[:subject],
        html: email_html(content:, data:),
        text: email_text(content:, data:)
      }.to_json
      request.options.open_timeout = 5
      request.options.timeout = 10
    end
    log_rejection("resend", template, response)
    { delivered: response.success?, status: response.status }
  end

  # Logs only the provider, template and status code: provider response bodies
  # can echo the message (and therefore the token link or code) back. Authentication
  # failures (401/403) are rejected before the message is read, so their reason is
  # logged too (e.g. Brevo's "unrecognised IP address"), truncated.
  AUTH_FAILURE_STATUSES = [401, 403].freeze

  def self.log_rejection(provider, template, response)
    return if response.success?
    entry = { event: "email_delivery_rejected", provider:, template:, status: response.status }
    entry[:reason] = provider_reason(response) if AUTH_FAILURE_STATUSES.include?(response.status)
    Rails.logger.warn(entry.compact.to_json)
  end

  def self.provider_reason(response)
    body = JSON.parse(response.body.to_s)
    body = body.is_a?(Hash) ? body : {}
    [body["code"], body["message"] || body["name"]].compact.join(": ").truncate(240).presence
  rescue JSON::ParserError
    nil
  end

  # Link templates require data[:link]; code templates data[:code]; notices data[:detail].
  def self.email_body_value(content:, data:)
    return data.fetch(:link) if content[:action]
    content[:notice] ? data.fetch(:detail).to_s : data.fetch(:code).to_s
  end

  # A template's heading/copy is normally a plain string; a small number (vouch_invite) need
  # a value from data (the voucher's name), so either is accepted here.
  def self.render_value(value, data) = value.respond_to?(:call) ? value.call(data) : value

  def self.email_text(content:, data:)
    value = email_body_value(content:, data:)
    value = "#{content[:action]}: #{value}" if content[:action]
    ["Verse", render_value(content[:heading], data), render_value(content[:copy], data), value, [content[:footer] || DEFAULT_FOOTER, (SERVICE_NOTE unless content[:service_note] == false)].compact.join("\n")].join("\n\n")
  end

  def self.email_html(content:, data:)
    value = ERB::Util.html_escape(email_body_value(content:, data:))
    body = if content[:action]
      button_html(content[:action], email_body_value(content:, data:))
    elsif content[:notice]
      %(<p style="margin:18px 0 0;font-size:18px;font-weight:700;color:#f8fafc">#{value}</p>)
    else
      %(<p style="margin:22px 0 0;font-family:'Courier New',monospace;font-size:34px;font-weight:800;letter-spacing:8px;color:#f8fafc">#{value}</p>)
    end
    footer = ERB::Util.html_escape(content[:footer] || DEFAULT_FOOTER)
    heading = ERB::Util.html_escape(render_value(content[:heading], data))
    copy = ERB::Util.html_escape(render_value(content[:copy], data))
    service_note = content[:service_note] == false ? "" : %(<p style="margin-top:8px;color:#94a3b8;font-size:13px">#{SERVICE_NOTE}</p>)
    <<~HTML.squish
      #{head_html(render_value(content[:copy], data))}<div style="max-width:560px;margin:0 auto;padding:40px 24px">#{brand_header_html}<h1 style="font-size:28px;margin:28px 0 12px">#{heading}</h1><p style="color:#cbd5e1;line-height:1.6">#{copy}</p>#{body}<p style="margin-top:28px;color:#94a3b8;font-size:13px">#{footer}</p>#{service_note}</div></body></html>
    HTML
  end

  private_class_method :deliver_with_brevo, :deliver_with_resend, :email_html, :email_text, :email_body_value, :log_rejection

  # --- Notification emails (messaging/notifications area) -----------------------
  # Sends content already rendered by NotificationEmail through the configured
  # provider. Same result/raise_errors contract as .call; logs never include content.
  def self.deliver_rendered(to:, template:, subject:, html:, text:, headers: {}, raise_errors: false)
    return { delivered: false, reason: "Recipient unavailable" } if to.blank?
    return { delivered: false, reason: "Recipient suppressed" } if EmailSuppression.blocks_notifications?(to)

    provider_name = provider
    return { delivered: false, reason: "Email provider not configured" } unless provider_name

    response = Faraday.post(rendered_endpoint(provider_name)) do |request|
      request.headers["Content-Type"] = "application/json"
      request.headers["Accept"] = "application/json"
      case provider_name
      when "brevo"
        request.headers["api-key"] = ENV.fetch("BREVO_API_KEY")
        request.body = { sender: { name: ENV.fetch("BREVO_SENDER_NAME", "Verse"), email: ENV.fetch("BREVO_SENDER_EMAIL") },
          to: [{ email: to }], subject:, htmlContent: html, textContent: text, headers: headers.presence }.compact.to_json
      when "resend"
        request.headers["Authorization"] = "Bearer #{ENV.fetch('RESEND_API_KEY')}"
        request.body = { from: ENV.fetch("EMAIL_FROM"), to: [to], subject:, html:, text:, headers: headers.presence }.compact.to_json
      else
        request.headers["Authorization"] = "Bearer #{ENV['EMAIL_DELIVERY_TOKEN']}" if ENV["EMAIL_DELIVERY_TOKEN"].present?
        request.body = { to:, template:, data: { subject:, html:, text:, headers: headers.presence }.compact }.to_json
      end
      request.options.open_timeout = 5
      request.options.timeout = 10
    end
    log_rejection(provider_name, template, response)
    { delivered: response.success?, status: response.status, provider: provider_name }
  rescue StandardError => error
    raise if raise_errors
    Rails.logger.error("notification email delivery failed: #{error.class}")
    ErrorReporter.capture(error, tags: { source: "notification_email_delivery_failed", template: })
    { delivered: false, reason: "delivery error" }
  end

  def self.rendered_endpoint(provider_name)
    { "brevo" => "https://api.brevo.com/v3/smtp/email", "resend" => "https://api.resend.com/emails" }
      .fetch(provider_name) { ENV.fetch("EMAIL_DELIVERY_WEBHOOK") }
  end
  private_class_method :rendered_endpoint
end
