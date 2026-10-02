require "test_helper"

class FounderReportTest < ActiveJob::TestCase
  # Monday 28 Sep 2026, 09:00 IST. The report covers Mon 21 Sep 00:00 IST to Mon 28 Sep 00:00 IST.
  NOW = Time.utc(2026, 9, 28, 3, 30)
  WEEK_START = Time.utc(2026, 9, 20, 18, 30)
  WEEK_END = Time.utc(2026, 9, 27, 18, 30)
  DESCRIPTION = "A properly documented professional opportunity with clear responsibilities and terms.".freeze

  setup do
    @seq = 0
    @saved_env = ENV.to_h.slice("FOUNDER_REPORT_TO", "ADMIN_ORIGIN", "FRONTEND_URL")
    ENV["ADMIN_ORIGIN"] = "https://admin.example.test"
  end

  teardown do
    %w[FOUNDER_REPORT_TO ADMIN_ORIGIN FRONTEND_URL].each { ENV.delete(_1) }
    @saved_env.each { |key, value| ENV[key] = value }
  end

  # --- Week boundaries ---

  test "the week is Monday to Sunday in IST, closed at midnight IST" do
    window = FounderReport.week_before(NOW)
    assert_equal WEEK_START, window.starts_at
    assert_equal WEEK_END, window.ends_at

    # Sunday 23:30 IST is still that week, so the report is for the week before.
    assert_equal Time.utc(2026, 9, 13, 18, 30), FounderReport.week_before(Time.utc(2026, 9, 27, 18, 0)).starts_at
    # Monday 00:30 IST has just closed Sunday, so that week is now the one reported.
    assert_equal WEEK_START, FounderReport.week_before(Time.utc(2026, 9, 27, 19, 0)).starts_at
    assert_equal "21–27 Sep 2026", FounderReport.new(now: NOW).week_label
    assert_equal "28 Sep – 4 Oct 2026", FounderReport.new(now: Time.utc(2026, 10, 11, 3, 30)).week_label
  end

  test "sign-ups on the boundaries land in the right IST week" do
    musician(created_at: WEEK_START - 1.second)   # Sunday 23:59:59 IST, last week
    musician(created_at: WEEK_START)              # Monday 00:00:00 IST, this week
    musician(created_at: WEEK_END - 1.second)     # Sunday 23:59:59 IST, this week
    musician(created_at: WEEK_END)                # Monday 00:00:00 IST, next week

    data = FounderReport.new(now: NOW).call
    assert_equal 2, data[:current][:musicians]
    assert_equal 1, data[:previous][:musicians]
  end

  # --- Numbers, organic only ---

  test "every figure counts organic accounts only" do
    populate(batch: nil, times: 1)
    populate(batch: "demo-report", times: 3)
    Subscription.create!(user: User.organic.find_by(role: "employer"), plan_code: "pro", provider: "internal", status: "early_access",
      early_access: true, trial_started_at: NOW, trial_ends_at: NOW + 30.days)

    data = FounderReport.new(now: NOW).call
    current = data[:current]

    assert_equal({ musicians: 3, musiciansComplete: 1, hirers: 1, hirersComplete: 1 },
      current.slice(:musicians, :musiciansComplete, :hirers, :hirersComplete))
    assert_equal 1, data[:previous][:musicians]
    assert_equal 2, current[:opportunities]
    assert_equal 1, data[:previous][:opportunities]
    assert_equal 1, current[:approved]
    assert_equal 4, current[:urgent]
    assert_equal 3, current[:urgentResponded]
    assert_equal 1, current[:urgentFilled]
    assert_equal 30.0, current[:urgentMedianMinutes]
    assert_equal 1, current[:applications]
    assert_equal 2, current[:enquiries]
    assert_equal 1, current[:quotes]
    assert_equal 1, current[:bookingsAccepted]
    assert_equal 1, current[:bookingsCompleted]
    assert_equal 2, current[:messages]

    waiting = data[:waiting]
    assert_equal 2, waiting[:opportunities]
    assert_equal Time.utc(2026, 9, 17, 3, 30), waiting[:oldestOpportunityAt]
    assert_equal [2, 1], waiting.values_at(:verification, :verificationWeekAgo)
    assert_equal [1, 0], waiting.values_at(:reports, :reportsWeekAgo)

    needs = data[:needsYou]
    assert_equal 2, needs[:opportunities].size
    assert_equal ["Organic old pending", "Organic pending"], needs[:opportunities].map { _1[:text].sub(/ \(.*/, "") }
    assert_equal 2, needs[:verification].size
    assert_equal 1, needs[:reportsTotal]
    assert_equal 1, needs[:urgentTotal]
    assert_equal ["Organic unanswered in Pune"], needs[:urgent].map { _1[:text] }

    assert_equal({ used: 1, total: BillingConfig.early_access_seats }, data[:earlyAccess])
    assert_not data[:quiet]
  end

  test "the funnel leaves out synthetic events and names the biggest drop-off in one sentence" do
    demo = User.create!(name: "Demo Visitor", email: "demo-visit-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!",
      role: "jobseeker", status: "active", synthetic_batch: "demo-report")
    at = WEEK_START + 2.days
    events = []
    10.times { |i| events << event("landing_view", "anon-#{i}", at) }
    4.times { |i| events << event("path_chosen", "anon-#{i}", at) }
    3.times { |i| events << event("signup_completed", "anon-#{i}", at) }
    3.times { |i| events << event("job_posted", "anon-#{i}", at) }
    3.times { |i| events << event("booking_quote_accepted", "anon-#{i}", at) }
    5.times { |i| events << event("landing_view", "demo-#{i}", at, user_id: demo.id) }
    events << event("landing_view", "last-week", WEEK_START - 2.days)
    ProductEvent.insert_all(events)

    data = FounderReport.new(now: NOW).call
    assert_equal [10, 4, 3, 3, 3], data[:funnel][:steps].map { _1[:count] }
    assert_equal [1, 0, 0, 0, 0], data[:funnel][:previousSteps].map { _1[:count] }
    assert_equal({ from: "landing_view", to: "path_chosen", fromCount: 10, toCount: 4, lostPercent: 60 }, data[:funnel][:biggestDropOff])

    text = FounderReportMail.render(data, now: NOW)[:text]
    assert_includes text, "Biggest drop-off: of 10 who visited MusiLynk, 4 chose musician or hirer (60% did not)."
  end

  # --- Quiet week ---

  test "a week with nothing from real accounts reads as a quiet week, not a page of zeros" do
    populate(batch: "demo-report", times: 2) # only synthetic activity
    data = FounderReport.new(now: NOW).call
    assert data[:quiet]

    mail = FounderReportMail.render(data, now: NOW)
    assert_equal "MusiLynk week 21–27 Sep 2026: a quiet week", mail[:subject]
    assert_includes mail[:text], "A QUIET WEEK"
    assert_includes mail[:text], "Nothing is waiting for you."
    assert_not_includes mail[:text], "New musicians"
    assert_not_includes mail[:html], "New musicians"
    assert_not_includes mail[:text], "Visited MusiLynk"
    assert_not_includes mail[:text], ": 0"
  end

  # --- Copy and formats ---

  test "the email uses Indian number grouping and plain copy, and the plain text stands alone" do
    assert_equal "12,34,567", IndianFormat.number(1_234_567)
    assert_equal "1,23,456", IndianFormat.number(123_456)
    assert_equal "1,234", IndianFormat.number(1234)
    assert_equal "999", IndianFormat.number(999)
    assert_equal "0", IndianFormat.number(0)

    populate(batch: nil, times: 1)
    mail = FounderReportMail.render(FounderReport.new(now: NOW).call, now: NOW)

    assert_equal "MusiLynk week 21–27 Sep 2026: 4 sign-ups, 6 things need you", mail[:subject]
    text = mail[:text]
    assert_includes text, "- New musicians: 3 (up 2 on last week; 1 finished their profile)"
    assert_includes text, "- Waiting for review: 2 (oldest has waited 11 days)"
    assert_includes text, "- Median time to first response: 30 min"
    assert_includes text, "- Verification requests: 2 (1 a week ago)"
    assert_includes text, "EARLY ACCESS PRO\n0 of #{BillingConfig.early_access_seats} seats used."
    assert_not_includes text, "<"
    assert_no_match(/\b(synthetic|demo data|mock|placeholder)\b/i, text)
    assert_no_match(/[\u{1F300}-\u{1FAFF}]/, text)
  end

  test "every link goes to a real admin tab on the admin site, in both versions" do
    populate(batch: nil, times: 1)
    mail = FounderReportMail.render(FounderReport.new(now: NOW).call, now: NOW)

    text_links = mail[:text].scan(%r{https?://\S+})
    html_links = Nokogiri::HTML(mail[:html]).css("a[href]").map { _1["href"] }
    [text_links, html_links].each do |links|
      assert_not_empty links
      links.each do |link|
        uri = URI.parse(link)
        assert_equal "admin.example.test", uri.host
        assert_equal "/admin", uri.path
        assert_includes [nil, "tab=queue", "tab=verification", "tab=reports", "tab=urgent"], uri.query
      end
    end
    %w[queue verification reports urgent].each { assert_includes text_links, "https://admin.example.test/admin?tab=#{_1}" }
    assert_includes mail[:html], 'name="viewport"'
  end

  test "the admin links fall back to the public site when no admin site is configured" do
    ENV.delete("ADMIN_ORIGIN")
    ENV["FRONTEND_URL"] = "https://verse.example.test/"
    assert_equal "https://verse.example.test/admin?tab=queue", FounderReport.admin_url("queue")
  end

  test "html escapes what people typed" do
    employer = hirer
    Job.create!(employer:, title: "<script>alert(1)</script>", company: "Co", location: "Mumbai", kind: "Contract", genre: "Pop",
      description: DESCRIPTION, status: "pending").update_columns(created_at: WEEK_START + 1.day)
    mail = FounderReportMail.render(FounderReport.new(now: NOW).call, now: NOW)
    assert_not_includes mail[:html], "<script>"
    assert_includes mail[:html], "&lt;script&gt;"
  end

  # --- Recipients, job, schedule, rake ---

  test "recipients are FOUNDER_REPORT_TO, else the active admins" do
    User.create!(name: "Boss", email: "boss-#{@seq += 1}@example.com", password: "StrongPass123!", role: "admin", status: "active")
    User.create!(name: "Old Boss", email: "old-boss-#{@seq}@example.com", password: "StrongPass123!", role: "admin", status: "suspended")
    assert_equal ["boss-1@example.com"], FounderReport.recipients

    ENV["FOUNDER_REPORT_TO"] = "a@example.com, b@example.com;a@example.com"
    assert_equal %w[a@example.com b@example.com], FounderReport.recipients
  end

  test "the job queues one delivery per recipient with the rendered report" do
    ENV["FOUNDER_REPORT_TO"] = "a@example.com,b@example.com"
    populate(batch: nil, times: 1)

    assert_enqueued_jobs 2, only: FounderReportDeliveryJob do
      FounderReportJob.perform_now(NOW)
    end
    job = enqueued_jobs.find { _1["job_class"] == "FounderReportDeliveryJob" }
    assert_equal "a@example.com", job["arguments"][0]
    assert_match(/\AVerse week 21–27 Sep 2026/, job["arguments"][1])
  end

  test "the job does nothing, and says so, when there is nobody to send to" do
    assert_no_enqueued_jobs(only: FounderReportDeliveryJob) { FounderReportJob.perform_now(NOW) }
  end

  test "the schedule is registered for Monday 09:00 IST" do
    entry = Rails.application.config.good_job.cron.fetch(:founder_report)
    assert_equal "FounderReportJob", entry[:class]
    assert_equal "30 3 * * 1", entry[:cron]
    assert entry[:class].constantize < ApplicationJob

    fire = Fugit::Cron.parse(entry[:cron]).next_time(Time.utc(2026, 9, 28, 3, 31)).to_t
    assert_equal Time.utc(2026, 10, 5, 3, 30), fire
    assert_equal "Monday 09:00", fire.in_time_zone("Asia/Kolkata").strftime("%A %H:%M")
  end

  test "reports:founder[preview] prints the plain-text report and sends nothing" do
    Rails.application.load_tasks unless Rake::Task.task_defined?("reports:founder")
    populate(batch: nil, times: 1)
    task = Rake::Task["reports:founder"]
    task.reenable

    output = capture_io { task.invoke("preview") }.first
    assert_match(/\ASubject: MusiLynk week /, output)
    assert_includes output, "NEEDS YOU"
    assert_no_enqueued_jobs
  end

  private

  def user(role, batch: nil, complete: false, created_at: WEEK_START + 1.day)
    @seq += 1
    User.create!(name: "#{batch ? 'Synthetic' : 'Organic'} #{role} #{@seq}", email: "fr-#{@seq}-#{SecureRandom.hex(3)}@example.com",
      password: "StrongPass123!", role:, status: "active", synthetic_batch: batch, profile_complete: complete).tap do |u|
      u.update_columns(created_at:)
    end
  end

  def musician(created_at:, complete: false) = user("jobseeker", created_at:, complete:)

  def hirer = user("employer", complete: true)

  def event(name, anon_id, at, user_id: nil)
    { id: "prod_#{SecureRandom.hex(6)}", anon_id:, name:, props: {}, user_id:, created_at: at }
  end

  # One hirer and a handful of musicians with a known week of activity. `batch` makes them synthetic.
  def populate(batch:, times:)
    label = batch ? "Synthetic" : "Organic"
    times.times do |n|
      tuesday = WEEK_START + 1.day
      m1 = user("jobseeker", batch:, complete: true, created_at: tuesday)
      user("jobseeker", batch:, created_at: WEEK_END - 1.second)
      user("jobseeker", batch:, created_at: WEEK_START)
      user("jobseeker", batch:, created_at: WEEK_START - 1.second) # last week
      h = user("employer", batch:, complete: true, created_at: tuesday)

      job = lambda do |title, status, created_at, published_at = nil|
        Job.create!(employer: h, title:, company: "Co", location: "Mumbai", kind: "Contract", genre: "Pop", description: DESCRIPTION, status:).tap do |j|
          j.update_columns(created_at:, published_at:)
        end
      end
      job.call("#{label} pending", "pending", tuesday)
      approved = job.call("#{label} approved", "published", tuesday + 1.day, tuesday + 2.days)
      job.call("#{label} old pending", "pending", NOW - 11.days) # posted the week before, still waiting
      Application.create!(job: approved, candidate: m1, status: "Applied").update_columns(created_at: tuesday + 3.days)

      urgent = lambda do |title, created_at, status: "open", responded_after: nil, updated_at: nil|
        UrgentRequest.create!(requester: h, title:, role_name: "Bassist", city: "Pune", currency: "INR", status:, start_at: NOW + 3.days).tap do |r|
          r.update_columns(created_at:, updated_at: updated_at || created_at)
          UrgentRequestResponse.create!(urgent_request: r, user: m1, status: "available", created_at: created_at + responded_after) if responded_after
        end
      end
      urgent.call("#{label} fast", tuesday + 10.hours, responded_after: 30.minutes)
      urgent.call("#{label} slow", tuesday + 11.hours, responded_after: 90.minutes)
      urgent.call("#{label} filled", tuesday + 1.day, status: "filled", responded_after: 20.minutes, updated_at: tuesday + 2.days)
      urgent.call("#{label} unanswered", WEEK_END - 1.day)
      urgent.call("#{label} too new to flag", NOW - 1.hour)

      act = Act.create!(owner: m1, name: "#{label} Act #{n}", act_type: "band", currency: "INR", fee_basis: "event", status: "active")
      booking = lambda do |status, created_at, updated_at|
        BookingRequest.create!(act:, requester: h, event_type: "wedding", city: "Pune", currency: "INR", status:).tap do |b|
          b.update_columns(created_at:, updated_at:)
        end
      end
      accepted = booking.call("accepted", tuesday, tuesday + 1.day)
      booking.call("completed", tuesday + 1.day, tuesday + 3.days)
      BookingQuote.create!(booking_request: accepted, created_by: m1, performance_fee: 50_000, currency: "INR", status: "accepted").update_columns(created_at: tuesday)

      conversation = Conversation.create!(candidate: m1, employer: h)
      Message.create!(conversation:, sender: h, body: "Hello").update_columns(created_at: tuesday + 4.days)
      Message.create!(conversation:, sender: m1, body: "Hi").update_columns(created_at: tuesday + 4.days + 1.hour)

      VerificationRequest.create!(user: m1, kind: "professional").update_columns(created_at: NOW - 13.days)
      VerificationRequest.create!(user: m1, kind: "organization").update_columns(created_at: NOW - 4.days)
      Report.create!(reporter: m1, entity_type: "User", entity_id: h.id, reason: "spam", status: "open").update_columns(created_at: NOW - 4.days)

      next if batch

      # Organic musicians applying to a synthetic hirer's opportunity, or messaging one, are not real activity.
      demo_hirer = user("employer", batch: "demo-report")
      demo_job = Job.create!(employer: demo_hirer, title: "Demo gig", company: "Co", location: "Mumbai", kind: "Contract", genre: "Pop",
        description: DESCRIPTION, status: "published")
      Application.create!(job: demo_job, candidate: m1, status: "Applied").update_columns(created_at: tuesday)
      Message.create!(conversation: Conversation.create!(candidate: m1, employer: demo_hirer), sender: m1, body: "Hi").update_columns(created_at: tuesday)
    end
  end
end
