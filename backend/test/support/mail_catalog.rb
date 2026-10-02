# Every email the app can send and every in-app notification it can raise, built from realistic
# fixture data, so one test (and the render script behind the email audit) can check all of them
# the same way. Call MailCatalog.build inside a transaction (tests are, so nothing is kept).
#
# emails:        [Email(id, group, recipient, subject, html, text, headers)]
# notifications: [Note(id, kind, link, recipient, title, body, source)] raised through the real
#                Notifier / job / service code, except the few controller-only ones (see
#                CONTROLLER_NOTIFICATIONS, kept honest by a test that scans the source).
module MailCatalog
  Email = Struct.new(:id, :template, :group, :recipient, :subject, :html, :text, :headers, keyword_init: true)
  Note = Struct.new(:id, :kind, :link, :recipient, :title, :body, :source, keyword_init: true)

  FRONT = "https://musilynk.example"

  # Notification.create! calls that live in controllers. Each is listed with the link it writes
  # (the helper-built ones for both workspaces) so the link check covers them.
  CONTROLLER_NOTIFICATIONS = [
    { kind: "urgent_response", link: ->(u) { "/messages?c=conv_1" }, source: "urgent_requests_controller#respond" },
    { kind: "urgent_accepted", link: ->(u) { "/messages?c=conv_1" }, source: "urgent_requests_controller#accept" },
    { kind: "workspace", link: ->(_) { nil }, source: "organizations_controller#add_member" }
  ].freeze

  module_function

  def user(role, name:, email:, city: "Mumbai", roles: ["Drummer"])
    user = User.create!(name:, email:, password: "StrongPass123!", role:, status: "active", email_verified: true)
    user.create_profile!(location: city, roles:, genres: ["Rock"], headline: "#{roles.first} based in #{city}")
    user
  end

  def build
    ActiveJob::Base.queue_adapter = :test
    ENV["FRONTEND_URL"] = FRONT
    ENV["EMAIL_DELIVERY_WEBHOOK"] ||= "https://email-hook.example.invalid/send"
    @emails = []
    @notes = []
    @musician = user("jobseeker", name: "Asha Rao", email: "asha.catalog@example.com")
    @other_musician = user("jobseeker", name: "Rohan Mehta", email: "rohan.catalog@example.com", roles: ["Tabla"])
    @hirer = user("employer", name: "Meera Kapoor", email: "meera.catalog@example.com")
    @other_hirer = user("employer", name: "Dev Malhotra", email: "dev.catalog@example.com")
    @token = "tok_Zm9vYmFyYmF6cXV4"

    account_emails
    notification_emails_and_notes
    lifecycle_emails
    digest_emails
    other_notes
    { emails: @emails, notifications: @notes, musician: @musician, hirer: @hirer }
  end

  # --- Emails that go out through EmailDelivery (account and security) -------------------------
  def account_emails
    link = ->(path) { "#{FRONT}#{path}?token=#{@token}" }
    data = {
      "reset_password" => { link: link.("/reset-password") },
      "verify_email" => { link: link.("/verify-email") },
      "sign_in_code" => { code: "482915" },
      "admin_email_change" => { code: "739104" },
      "admin_email_changed" => { detail: "new.admin@example.com" },
      "account_email_change" => { code: "205871" },
      "account_email_changed" => { detail: "asha.new@example.com" },
      "account_password_set" => { detail: "asha.catalog@example.com" },
      "account_password_removed" => { detail: "asha.catalog@example.com" },
      "google_connected" => { link: NotificationEmail.settings_link(@musician) },
      "vouch_invite" => { link: "#{FRONT}/join/musician?vouch=vch_Zm9vYmFy", name: "Asha Rao" },
      "act_invite" => { link: "#{FRONT}/invites/Zm9vYmFyYmF6cXV4", name: "Asha Rao", act: "The Night Owls", role: "Drummer" },
      "problem_report" => { link: "#{FRONT}/admin?tab=problems&report=prob_0f8e6c1a-2b4d-4c7e-9a31-5d6e7f8a9b0c", name: "Asha Rao" }
    }
    EmailDelivery::TEMPLATES.each do |template, content|
      template_data = data.fetch(template) { raise "MailCatalog has no fixture data for email template #{template}" }
      @emails << Email.new(id: template, template:, group: "account", recipient: "person@example.com", subject: content[:subject],
        html: EmailDelivery.send(:email_html, content:, data: template_data),
        text: EmailDelivery.send(:email_text, content:, data: template_data), headers: {})
    end
  end

  # --- Notification emails, with the in-app notice raised by the same Notifier call ------------
  def notification_emails_and_notes
    act = Act.create!(owner: @musician, name: "The Night Owls", act_type: "Band", currency: "INR", fee_basis: "event", status: "active")
    booking = BookingRequest.create!(act:, requester: @hirer, event_type: "Wedding", city: "Mumbai", currency: "INR", status: "requested")
    job = Job.create!(employer: @hirer, title: "Wedding sangeet drummer", company: "Kapoor Events", location: "Mumbai", kind: "gig",
      genre: "Bollywood", description: "A properly documented professional opportunity with clear responsibilities and terms.", status: "published",
      application_deadline: 3.days.from_now)
    application = Application.create!(job:, candidate: @musician)
    urgent = UrgentRequest.create!(requester: @hirer, title: "Tabla player for Saturday sangeet", role_name: "Tabla", city: "Mumbai",
      currency: "INR", status: "open", start_at: Time.utc(2026, 10, 9, 13, 0))

    capture("booking_enquiry", @musician) { Notifier.booking_enquiry(booking) }
    capture("booking_quote", @hirer) { Notifier.booking_quote(booking) }
    BookingRequest::STATUSES.excluding("requested", "quoted").each do |status|
      booking.update_columns(status:)
      capture("booking_status_#{status}", @hirer) { Notifier.booking_status(booking, actor: @musician) }
    end
    capture("new_application", @hirer) { Notifier.new_application(application) }
    Application::STATUS_TRANSITIONS.keys.excluding("Applied").each do |status|
      application.update_columns(status:)
      capture("application_status_#{status.parameterize(separator: '_')}", @musician) { Notifier.application_status(application) }
    end
    conversation = Conversation.create!(candidate: @musician, employer: @hirer, job:)
    message = conversation.messages.create!(sender: @hirer, body: "Are you free on the 9th?")
    capture("new_message", @musician) { Notifier.new_message(message) }
    capture("urgent_request_alert", @musician) { Notifier.urgent_request_alert(urgent, @musician, ["Plays Tabla", "In Mumbai"]) }
    capture("urgent_request_expiry_warning", @hirer) do
      Notifier.urgent_request_expiry_warning(urgent, filled_link: UrgentActionToken.link(urgent, "filled", frontend_url: FRONT),
        close_link: UrgentActionToken.link(urgent, "close", frontend_url: FRONT))
    end
    capture("urgent_request_expired", @musician) { Notifier.urgent_request_expired(urgent, @musician) }
    capture("job_deadline_closed", @hirer) { Notifier.job_deadline_closed(job) }
    subscription = Subscription.create!(user: @hirer, plan_code: "pro", provider: "internal", status: "early_access",
      early_access: true, trial_ends_at: Time.utc(2026, 11, 9, 6, 0))
    capture("early_access_granted", @hirer) { Notifier.early_access_granted(subscription) }
    capture("verification_more_proof", @musician) do
      Notifier.verification_needs_more_proof(@musician, ["add a link to your best work", "add a clear photo of yourself"])
    end
    invite = ActInvite.new(act:, inviter: @musician, kind: "user", invitee_user: @other_musician, role_name: "Tabla", instrument: "Tabla")
    capture("act_invite", @other_musician) { Notifier.act_invite(invite, @other_musician) }
    capture("act_invite_accepted", @musician) { Notifier.act_invite_response(invite, @other_musician, accepted: true) }
    capture("act_invite_declined", @musician) { Notifier.act_invite_response(invite, @other_musician, accepted: false) }
    capture("verification_approved", @musician) { Notifier.verification_approved(@musician) }
    prompt = ReviewPrompt.create!(source_type: "urgent_request", source_id: urgent.id, user: @musician, counterpart: @hirer, counterpart_name: "Meera Kapoor")
    capture("review_prompt", @musician) { Notifier.review_prompt(prompt) }
    capture("review_prompt_reminder", @musician) { Notifier.review_prompt(prompt, reminder: true) }
    hirer_prompt = ReviewPrompt.create!(source_type: "urgent_request", source_id: urgent.id, user: @hirer, counterpart: @musician, counterpart_name: "Asha Rao")
    capture("review_prompt_hirer", @hirer) { Notifier.review_prompt(hirer_prompt) }

    billing_and_payments(subscription)
  end

  def billing_and_payments(early_access)
    today = Date.current
    at = ->(days) { (today + days).in_time_zone.change(hour: 12) }
    Subscription.create!(user: @hirer, plan_code: "pro", provider: "razorpay", status: "trialing", trial_ends_at: at.(3))
    Subscription.create!(user: @other_hirer, plan_code: "pro", provider: "razorpay", status: "active", interval: "annual", current_period_end: at.(3))
    Subscription.create!(user: @musician, plan_code: "pro", provider: "internal", status: "early_access", early_access: true, trial_ends_at: at.(7))
    capture_jobs { BillingRemindersJob.perform_now(today) }
    invoice = TaxInvoice.create!(user: @hirer, subscription: Subscription.find_by(user: @hirer), invoice_number: "MLK/2026-27/000123", financial_year: "2026-27", sequence_number: 123,
      document_type: "tax_invoice", issued_at: at.(0), provider_payment_id: "pay_catalog_invoice", buyer: { "name" => @hirer.name }, seller: {}, line_items: [],
      taxable_paise: 211_780, cgst_paise: 19_060, sgst_paise: 19_060, total_paise: 249_900)
    capture("invoice_issued", @hirer) { Notifier.invoice_issued(invoice) }
    add_notification_email("payments_open", @musician, { "path" => "#{FRONT}/pricing" })
  end

  def capture_jobs
    ActiveJob::Base.queue_adapter.enqueued_jobs.clear
    yield
    jobs = ActiveJob::Base.queue_adapter.enqueued_jobs.select { _1["job_class"] == "NotificationEmailJob" }
    jobs.each do |entry|
      user_id, template, params = ActiveJob::Arguments.deserialize(entry["arguments"])
      add_notification_email(template, User.find(user_id), params)
    end
  end

  def add_notification_email(template, user, params, id: template)
    content = NotificationEmail.render(template, params, user)
    @emails << Email.new(id:, template:, group: "notification", recipient: user, subject: content[:subject], html: content[:html],
      text: content[:text], headers: content[:headers])
  end

  # Runs a Notifier call and records the in-app notice and the queued notification email it makes.
  def capture(id, recipient)
    ActiveJob::Base.queue_adapter.enqueued_jobs.clear
    before = Notification.pluck(:id)
    yield
    Notification.where.not(id: before).find_each do |n|
      @notes << Note.new(id:, kind: n.kind, link: n.link, recipient: n.user, title: n.title, body: n.body, source: "Notifier")
    end
    ActiveJob::Base.queue_adapter.enqueued_jobs.each do |entry|
      next unless entry["job_class"] == "NotificationEmailJob"
      user_id, template, params = ActiveJob::Arguments.deserialize(entry["arguments"])
      add_notification_email(template, User.find(user_id), params, id: id)
    end
  end

  # --- Lifecycle sequences, milestones ------------------------------------------------------
  def lifecycle_emails
    params = {
      "musician_day21_inactive_requests" => { "count" => 3, "city" => "Mumbai" },
      "hirer_day3_meet_verified" => { "city" => "Mumbai", "role" => "Vocalist" },
      "hirer_day7_listing_applicants" => { "title" => "Wedding sangeet drummer", "count" => 4 },
      "hirer_day14_inactive_response_time" => { "city" => "Mumbai", "hours" => 2.5 },
      "milestone_hirer_first_application" => { "candidate" => "Asha Rao", "job" => "Wedding sangeet drummer" },
      "milestone_musician_first_response" => { "minutes" => 12 }
    }
    LifecycleMailer::STEPS.each_key do |key|
      recipient = key.start_with?("hirer", "milestone_hirer") ? @hirer : @musician
      content = LifecycleMailer.render_step(key, params.fetch(key, {}), recipient)
      @emails << Email.new(id: key, template: key, group: "lifecycle", recipient:, subject: content[:subject], html: content[:html],
        text: content[:text], headers: {})
    end
  end

  # --- Weekly digest (musician and hirer) ---------------------------------------------------
  def digest_emails
    now = Time.utc(2026, 10, 6, 4, 0)
    UrgentRequest.create!(requester: @hirer, title: "Drummer for Friday show", role_name: "Drummer", city: "Mumbai",
      currency: "INR", status: "open", start_at: now + 2.days)
    UrgentRequest.create!(requester: @hirer, title: "Keys for a corporate night", role_name: "Drummer", city: "Mumbai",
      currency: "INR", status: "open", start_at: now + 3.days)
    verified = user("jobseeker", name: "Neha Iyer", email: "neha.catalog@example.com", roles: ["Vocalist"])
    verified.profile.update!(verified: true)
    verified.verification_requests.create!(kind: "professional", status: "approved", reviewed_at: now - 2.days)
    Job.create!(employer: @hirer, title: "Need a vocalist", company: "Kapoor Events", location: "Mumbai", kind: "gig", genre: "Rock",
      skills: ["Vocalist"], description: "A properly documented professional opportunity with clear responsibilities and terms.", status: "published")
    [[@musician, "digest_musician"], [@hirer, "digest_hirer"]].each do |recipient, id|
      sections = WeeklyDigest.build(recipient, since: now - 7.days, until_time: now)
      content = LifecycleMailer.render_digest(sections.map(&:deep_stringify_keys).map(&:deep_symbolize_keys), recipient,
        subject: WeeklyDigest.subject_for(sections))
      @emails << Email.new(id:, template: id, group: "digest", recipient:, subject: content[:subject], html: content[:html], text: content[:text], headers: {})
    end
  end

  # --- In-app notices that do not come through Notifier -------------------------------------
  def other_notes
    # Notifier-only kinds with no email: raised through the real Notifier methods.
    post = Post.create!(author_type: "user", author_id: @musician.id, created_by_user_id: @musician.id, body: "New single out on Friday", status: "active")
    actor = Struct.new(:name, :user).new("Rohan Mehta", @other_musician)
    comment = post.post_comments.create!(author_type: "user", author_id: @other_musician.id, created_by_user_id: @other_musician.id, body: "Love this", status: "active")
    reply = post.post_comments.create!(author_type: "user", author_id: @hirer.id, created_by_user_id: @hirer.id, body: "Agreed", status: "active", parent_id: comment.id)
    reshare = Post.create!(author_type: "user", author_id: @other_musician.id, created_by_user_id: @other_musician.id, reshared_post_id: post.id, status: "active")
    follow = Follow.create!(follower_user_id: @other_musician.id, followable_type: "user", followable_id: @musician.id)
    capture("stage_applause", @musician) { Notifier.stage_applause(post, actor) }
    capture("stage_comment", @musician) { Notifier.stage_comment(post, comment, actor) }
    capture("stage_reshare", @musician) { Notifier.stage_reshare(post, reshare, actor) }
    capture("stage_reply", @other_musician) { Notifier.stage_reply(post, comment, reply, Struct.new(:name).new("Meera Kapoor")) }
    capture("stage_follower", @musician) { Notifier.stage_new_follower(follow, @other_musician) }
    capture("moderation_warning", @musician) { Notifier.moderation_warning(@musician) }

    request = @musician.verification_requests.create!(kind: "professional", status: "pending")
    capture("verification_rejected", @musician) { Verification::Decision.reject!(request, reviewer: @hirer, reason: "The links did not open") }
    job = Job.find_by!(title: "Wedding sangeet drummer")
    %w[published rejected closed pending].each do |status|
      job.update_columns(status:)
      capture("job_review_update_#{status}", @hirer) { Notifier.job_review_update(job) }
    end
    job.update_columns(status: "published")
    job.update_columns(published_at: 1.hour.ago)
    alert = JobAlert.create!(user: @musician, name: "Drummer gigs in Mumbai", frequency: "daily", active: true, query: "drummer")
    capture("job_alert", @musician) { JobAlertDeliveryJob.perform_now(alert.id, 1.day.ago, 1.day.from_now) }

    CONTROLLER_NOTIFICATIONS.each do |spec|
      [@musician, @hirer].each do |recipient|
        @notes << Note.new(id: "#{spec[:source]}:#{recipient.role}", kind: spec[:kind], link: spec[:link].call(recipient), recipient:,
          title: nil, body: nil, source: spec[:source])
      end
    end
    job
  end
end
