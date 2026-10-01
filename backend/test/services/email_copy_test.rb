require "test_helper"

# The shape of every email (brand header, one button, unsubscribe or service note, Indian dates)
# and the links of the notification templates.
class EmailCopyTest < ActiveSupport::TestCase
  BUTTON = /display:inline-block;margin-top:18px;padding:13px 20px/

  setup do
    @musician = make_user("jobseeker")
    @hirer = make_user("employer")
  end

  test "IndianFormat prints day-first dates and 12-hour times in IST" do
    time = Time.utc(2026, 10, 5, 13, 0) # 6:30 pm IST
    assert_equal "5 Oct 2026", IndianFormat.date(time)
    assert_equal "5 Oct, 6:30 pm", IndianFormat.date_time(time)
    assert_equal "5 Oct, 7 pm", IndianFormat.date_time(Time.utc(2026, 10, 5, 13, 30))
    assert_equal "5 Oct, 6:30 pm", IndianFormat.date_time_from_iso("2026-10-05T13:00:00Z")
    assert_nil IndianFormat.date(nil)
    assert_nil IndianFormat.date_time(nil)
    assert_nil IndianFormat.date_time_from_iso("")
    assert_nil IndianFormat.date_time_from_iso("not a date")
  end

  test "every notification email has the brand header, exactly one button and an unsubscribe link" do
    NotificationEmail::TEMPLATES.each_key do |template|
      params = { "act" => "The Night Owls", "name" => "Asha", "job" => "Wedding set", "status" => "Under Review", "title" => "Wedding set",
                 "role" => "Drummer", "city" => "Mumbai", "until" => "5 Oct 2026", "endsOn" => "5 Oct 2026", "renewsOn" => "5 Oct 2026",
                 "planName" => "Pro", "amount" => "₹2,499", "days" => "7 days", "tips" => "a link", "filledLink" => "https://verse.example/f",
                 "closeLink" => "https://verse.example/c", "path" => "https://verse.example/cancel" }
      content = NotificationEmail.render(template, params, @musician)
      html = content[:html]
      assert_includes html, ">V</span>", "#{template}: brand mark"
      assert_includes html, ">Verse</span>", "#{template}: brand name"
      assert_equal 1, html.scan(BUTTON).size, "#{template}: one primary button"
      assert_includes html, "/unsubscribe?token=", "#{template}: unsubscribe link"
      assert_match(/^Verse\n\n/, content[:text])
      assert_includes content[:text], "Turn off these emails:"
    end
  end

  test "notification links never double the workspace prefix and land on real workspace pages" do
    musician = NotificationEmail.render("urgent_request_alert", { "title" => "Gig", "role" => "Drummer", "city" => "Pune" }, @musician)
    assert_includes musician[:text], "/jobseeker/urgent"
    assert_no_match %r{/jobseeker/jobseeker}, musician[:text]

    hirer = NotificationEmail.render("urgent_request_expiry_warning", { "title" => "Gig", "filledLink" => "https://verse.example/f", "closeLink" => "https://verse.example/c" }, @hirer)
    assert_includes hirer[:text], "/employer/urgent"
    assert_no_match %r{/employer/jobseeker}, hirer[:text]

    billing = NotificationEmail.render("early_access_granted", { "until" => "5 Oct 2026" }, @hirer)
    assert_includes billing[:text], "/employer/billing"
    assert_no_match %r{/employer/employer}, billing[:text]

    review = NotificationEmail.render("review_prompt", { "name" => "Asha", "path" => "/jobseeker/reviews?employerId=1" }, @musician)
    assert_includes review[:text], "/jobseeker/reviews?employerId=1"
    assert_no_match %r{/jobseeker/jobseeker}, review[:text]

    closed = NotificationEmail.render("job_deadline_closed", { "title" => "Wedding set" }, @hirer)
    assert_match %r{/employer\n}, closed[:text]
    assert_includes closed[:text], "Your opportunity closed at its deadline"
    assert_no_match(/listing/i, closed[:text])
  end

  test "the expiry warning keeps one button and shows the one-tap actions as plain links" do
    content = NotificationEmail.render("urgent_request_expiry_warning",
      { "title" => "Gig", "filledLink" => "https://verse.example/f", "closeLink" => "https://verse.example/c" }, @hirer)
    assert_equal 1, content[:html].scan(BUTTON).size
    assert_includes content[:html], %(href="https://verse.example/f")
    assert_includes content[:html], "Mark it filled"
    assert_includes content[:text], "Close it: https://verse.example/c"
  end

  test "an urgent alert says when in Indian time, and statuses read as words" do
    alert = NotificationEmail.render("urgent_request_alert",
      { "title" => "Wedding set", "role" => "Drummer", "city" => "Pune", "startAt" => "2026-10-05T13:00:00Z" }, @musician)
    assert_includes alert[:html], "Wedding set in Pune, 5 Oct, 6:30 pm."
    status = NotificationEmail.render("application_status", { "job" => "Wedding set", "status" => "Interview Scheduled" }, @musician)
    assert_includes status[:html], "is now marked as Interview Scheduled."
  end

  test "sequence emails use their own subject, singular and plural counts, and say opportunity" do
    one = LifecycleMailer.render_step("hirer_day7_listing_applicants", { "count" => 1, "title" => "Wedding set" }, @hirer)
    assert_equal "Your opportunity has 1 applicant", one[:subject]
    many = LifecycleMailer.render_step("hirer_day7_listing_applicants", { "count" => 4, "title" => "Wedding set" }, @hirer)
    assert_equal "Your opportunity has 4 applicants", many[:subject]
    first = LifecycleMailer.render_step("musician_day1_first_link", {}, @musician)
    assert_equal "Add your first work link", first[:subject]
    milestone = LifecycleMailer.render_step("milestone_musician_first_response", { "minutes" => 12 }, @musician)
    assert_equal "You responded in 12 minutes", milestone[:subject]
    LifecycleMailer::STEPS.each_key do |key|
      content = LifecycleMailer.render_step(key, { "count" => 2, "city" => "Mumbai", "role" => "Drummer", "title" => "Wedding set", "hours" => 2, "candidate" => "A", "job" => "J", "minutes" => 5 }, @hirer)
      assert_no_match(/listing/i, content[:html], key)
      assert_includes content[:html], ">V</span>"
      assert_equal 1, content[:html].scan(BUTTON).size, key
      assert_includes content[:html], "Manage emails"
    end
  end

  test "account emails have the brand header, one button at most, and say why they have no unsubscribe link" do
    EmailDelivery::TEMPLATES.each do |name, content|
      data = { link: "https://verse.example/x", code: "123456", detail: "a@example.com", name: "Asha" }
      html = EmailDelivery.send(:email_html, content:, data:)
      assert_includes html, ">V</span>", name
      assert_operator html.scan(BUTTON).size, :<=, 1, name
      assert_equal content[:action] ? 1 : 0, html.scan(BUTTON).size, name
      if content[:service_note] == false
        assert_not_includes html, EmailDelivery::SERVICE_NOTE, "#{name}: an invitee has no account to describe"
      else
        assert_includes html, EmailDelivery::SERVICE_NOTE, name
      end
      assert_no_match(/VERSE/, html, name)
      text = EmailDelivery.send(:email_text, content:, data:)
      assert_match(/^Verse\n\n/, text)
    end
  end

  private

  def make_user(role)
    user = User.create!(name: "Copy #{role}", email: "copy-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!",
      role:, status: "active", email_verified: true)
    user.create_profile!
    user
  end
end
