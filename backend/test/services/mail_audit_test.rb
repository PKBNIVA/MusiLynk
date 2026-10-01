require "test_helper"
require_relative "../support/mail_catalog"
require_relative "../support/frontend_routes"

# The email and notification audit as tests: every email template and every in-app notification
# kind is built from realistic data (test/support/mail_catalog.rb) and checked for links that land
# on real pages, copy rules (docs/VERSE_PLAN.md 5.1.6), opt-out footers and plain text.
class MailAuditTest < ActiveSupport::TestCase
  setup do
    # MailCatalog sets a provider and the frontend origin; put the environment back afterwards.
    @env = ENV.to_h.slice("FRONTEND_URL", "EMAIL_DELIVERY_WEBHOOK")
    @catalog = MailCatalog.build
  end

  teardown do
    %w[FRONTEND_URL EMAIL_DELIVERY_WEBHOOK].each { @env.key?(_1) ? ENV[_1] = @env[_1] : ENV.delete(_1) }
    ActiveJob::Base.queue_adapter.enqueued_jobs.clear if ActiveJob::Base.queue_adapter.respond_to?(:enqueued_jobs)
  end

  def hrefs(html) = html.scan(/href="([^"]+)"/).flatten.map { CGI.unescapeHTML(_1) }
  def visible_text(html) = CGI.unescapeHTML(html.gsub(/<(style|head)[^>]*>.*?<\/\1>/m, "").gsub(/<[^>]+>/, " ")).squish
  def ids = @catalog[:emails].map(&:template).uniq

  test "the catalog covers every template that exists" do
    NotificationEmail::TEMPLATES.each_key { |t| assert_includes ids, t, "notification email #{t} has no catalog fixture" }
    LifecycleMailer::STEPS.each_key { |t| assert_includes ids, t, "lifecycle email #{t} has no catalog fixture" }
    EmailDelivery::TEMPLATES.each_key { |t| assert_includes ids, t }
    assert_includes ids, "digest_musician"
    assert_includes ids, "digest_hirer"
  end

  test "the catalog covers every notification kind written in the source" do
    source = Dir[Rails.root.join("app/**/*.rb")].sum("") { File.read(_1) }
    kinds = source.scan(/kind: "([a-z_]+)"/).flatten.uniq - %w[update] # Post kinds are not notifications
    notification_kinds = kinds.select { |k| source.match?(/(notify|coalesce|Notification\.create!)\([^)]*kind: ?"?#{k}|kind: (#{k.upcase}|"#{k}")[^\n]*link:|MESSAGE_KIND/) }
    covered = @catalog[:notifications].map(&:kind).uniq
    missing = Dir[Rails.root.join("app/**/*.rb")].flat_map do |file|
      File.read(file).scan(/(?:notify\(|coalesce\(|Notification\.create!\()[^\n]*?kind: "([a-z_]+)"/).flatten
    end.uniq - covered
    assert_empty missing, "notification kinds with no catalog entry: #{missing.inspect}"
    assert_operator notification_kinds.size, :>, 5
  end

  test "every link in every email lands on a real page, on the frontend origin, with no doubled prefix" do
    @catalog[:emails].each do |email|
      urls = hrefs(email.html)
      assert_equal urls.sort, email.text.scan(%r{https://\S+}).sort.select { |u| urls.include?(u) || true }.select { |u| urls.include?(u) }.sort, "#{email.id}: every link also appears in plain text" unless urls.empty?
      urls.each do |url|
        uri = URI.parse(url)
        assert_equal "https://verse.example", "#{uri.scheme}://#{uri.host}", "#{email.id}: #{url} must use FRONTEND_URL"
        assert FrontendRoutes.exist?(uri.path), "#{email.id}: #{uri.path} is not a frontend route"
        assert_no_match %r{/(jobseeker|employer)/(jobseeker|employer)\b}, uri.path, "#{email.id}: doubled workspace prefix"
        assert_no_match %r{//}, uri.path
      end
    end
  end

  test "workspace links in an email match the recipient's role" do
    @catalog[:emails].select { _1.recipient.is_a?(User) }.each do |email|
      wrong = email.recipient.role == "employer" ? "/jobseeker" : "/employer"
      hrefs(email.html).each { |url| assert_no_match %r{\Ahttps://verse\.example#{wrong}(/|\z)}, url, "#{email.id}: #{url} is the other workspace" }
    end
  end

  test "token links carry their token" do
    @catalog[:emails].each do |email|
      hrefs(email.html).each do |url|
        next unless url.match?(%r{/(verify-email|reset-password|unsubscribe)\?})
        assert_match(/[?&]token=[^&]+/, url, "#{email.id}: #{url}")
      end
    end
  end

  test "notification and lifecycle emails carry a working unsubscribe link; account emails say why they cannot" do
    @catalog[:emails].each do |email|
      if %w[notification lifecycle digest].include?(email.group)
        link = hrefs(email.html).find { _1.include?("/unsubscribe?token=") }
        assert link, "#{email.id}: unsubscribe link"
        token = Rack::Utils.parse_query(URI.parse(link).query)["token"]
        assert_equal email.recipient, NotificationEmail.user_for_unsubscribe_token(token), "#{email.id}: token names the recipient"
        assert_includes email.text, "/unsubscribe?token="
      elsif email.id == "vouch_invite"
        assert_no_match(/cannot be turned off|your Verse account/, visible_text(email.html), "an invitee has no account yet")
      else
        assert_includes email.html, EmailDelivery::SERVICE_NOTE, "#{email.id}: service note"
      end
    end
  end

  test "every email has a subject, a preheader, a mobile viewport, one clear action and a plain-text twin" do
    @catalog[:emails].each do |email|
      assert email.subject.present?, "#{email.id}: subject"
      assert_operator email.subject.length, :<=, 80, "#{email.id}: subject too long"
      assert_includes email.html, 'name="viewport"', "#{email.id}: viewport"
      assert_match(/display:none[^>]*>[^<]{10,}</, email.html, "#{email.id}: preheader")
      buttons = email.html.scan("display:inline-block;margin-top:18px;padding:13px 20px").size
      code_email = %w[sign_in_code admin_email_change account_email_change admin_email_changed account_email_changed account_password_set].include?(email.id)
      assert_equal(code_email ? 0 : 1, buttons, "#{email.id}: button count")
      assert_match(/\AVerse\n\n/, email.text, "#{email.id}: text starts with the brand")
      assert_no_match(/<[a-z]+[ >]/, email.text, "#{email.id}: no HTML in plain text")
    end
  end

  test "copy follows the plan: rupees, Indian dates, plain words, no leaked ids or debug text" do
    @catalog[:emails].each do |email|
      [visible_text(email.html), email.text.gsub(%r{https?://\S+}, ""), email.subject].each do |text|
        assert_no_match(/\bINR\b|Rs\.? ?\d/, text, "#{email.id}: use the rupee sign")
        assert_no_match(%r{\b\d{1,2}/\d{1,2}/\d{2,4}\b|\b[A-Z][a-z]{2} \d{1,2}, \d{4}\b|\b\d{1,2}:\d{2} ?(AM|PM)\b}, text, "#{email.id}: US date or time format")
        assert_no_match(/\b(user|job|conv|post|vch|urgent|booking)_[0-9a-f]{8}\b/, text, "#{email.id}: internal id shown")
        assert_no_match(/\b(nil|undefined|NaN|null)\b|%\{|\{\{|\bsynthetic\b|\bmock\b|\bplaceholder\b|\bdemo data\b|_[a-z]+_/, text, "#{email.id}: debug or engineering text")
        assert_no_match(/\b1 (minutes|hours|days|applicants|requests)\b/, text, "#{email.id}: plural of one")
        assert_no_match(/\blisting\b|\bapplicants?\b.*\bhirer\b/i, text) unless email.id.include?("applic") || email.id.start_with?("hirer", "milestone_hirer", "digest")
      end
    end
  end

  test "rupee amounts and dates are formatted in the emails that carry them" do
    renewal = @catalog[:emails].find { _1.id == "plan_renewing_soon" }
    assert_match(/₹\d{1,3}(,\d{2})*,?\d{3}/, visible_text(renewal.html))
    alert = @catalog[:emails].find { _1.id == "urgent_request_alert" }
    assert_includes visible_text(alert.html), "9 Oct, 6:30 pm"
  end

  test "every notification link opens a real page for the person who gets it" do
    @catalog[:notifications].each do |note|
      destination = FrontendRoutes.notification_destination(note.link, note.recipient.role, note.kind)
      assert destination, "#{note.id}: #{note.link.inspect} leads nowhere"
      assert FrontendRoutes.exist?(destination), "#{note.id}: #{note.link.inspect} becomes #{destination}, which is not a frontend route"
      assert_no_match %r{/(jobseeker|employer)/(jobseeker|employer)\b}, destination
      assert_not_equal note.recipient.role == "employer" ? "/jobseeker" : "/employer", destination[%r{\A/\w+}], "#{note.id}: other workspace"
    end
  end

  test "notification text is plain words, not raw statuses or ids" do
    @catalog[:notifications].select(&:body).each do |note|
      text = "#{note.title} #{note.body}".gsub(/\b(user|job|conv|post)_[0-9a-f-]{36}\b/, "")
      assert_no_match(/\b[a-z]+_[a-z_]+\b/, text, "#{note.id}: raw status or enum in #{text.inspect}")
      assert_no_match(/: (published|pending|closed|rejected)\b/, text, "#{note.id}: raw status")
      assert_no_match(/\bINR\b|\bundefined\b|\bnil\b/, text)
    end
  end

  test "a synthetic or demo account is never emailed" do
    user = @catalog[:musician]
    user.update_columns(synthetic_batch: "demo-showcase")
    assert_not NotificationEmail.deliverable_to?(user)
    assert_not NotificationEmail.deliverable_to?(user, category: "digest")
    user.update_columns(synthetic_batch: nil)
    assert NotificationEmail.deliverable_to?(user)
  end

  test "the digest is skipped when it has nothing to say, and counts read in the right number" do
    quiet = MailCatalog.user("jobseeker", name: "Quiet Person", email: "quiet@example.com", city: "Nowhere", roles: ["Sitar"])
    quiet.profile.update!(genres: ["Folk"])
    sections = WeeklyDigest.build(quiet, since: 7.days.ago)
    assert_nil LifecycleMailer.render_digest(sections, quiet, subject: WeeklyDigest.subject_for(sections))
    assert_equal "This week on Verse", WeeklyDigest.subject_for(sections)
    one = [{ items: [{ text: "x" }], noun: "urgent request", where: "near you" }]
    assert_equal "1 urgent request near you this week", WeeklyDigest.subject_for(one)
    assert_equal "1 minute", LifecycleMailer.duration_words(1)
    assert_equal "12 minutes", LifecycleMailer.duration_words(12)
    assert_equal "3 hours", LifecycleMailer.duration_words(180)
  end

  test "digest and lifecycle emails are claimed once, so a repeat run sends nothing" do
    user = @catalog[:musician]
    assert LifecycleEmail.record!(user, LifecycleEmail.digest_key)
    assert_not LifecycleEmail.record!(user, LifecycleEmail.digest_key)
    assert LifecycleSequences.claim(user, "musician_day1_first_link")
    assert_not LifecycleSequences.claim(user, "musician_day1_first_link")
  end

  test "the digest links to the musician's or hirer's own workspace and never to a missing page" do
    digest = @catalog[:emails].find { _1.id == "digest_hirer" }
    assert_includes hrefs(digest.html), "https://verse.example/employer"
    assert_empty hrefs(digest.html).reject { |u| u.include?("/unsubscribe") || FrontendRoutes.exist?(URI.parse(u).path) }
  end

  test "a moderation update on an opportunity says what happened in words" do
    notes = @catalog[:notifications].select { _1.kind == "moderation" }
    assert_equal 4, notes.size
    assert_includes notes.map(&:body).join(" "), "is now live on Verse."
  end

  test "google sign-in link goes to the workspace settings page" do
    email = @catalog[:emails].find { _1.id == "google_connected" }
    assert_includes hrefs(email.html), "https://verse.example/jobseeker/settings"
  end
end
