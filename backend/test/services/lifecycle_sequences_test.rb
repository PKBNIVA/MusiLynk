require "test_helper"

class LifecycleSequencesTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @seq = 0
    clear_enqueued_jobs
    @previous_webhook = ENV["EMAIL_DELIVERY_WEBHOOK"]
    ENV["EMAIL_DELIVERY_WEBHOOK"] = "https://email-hook.example.invalid/send"
  end

  teardown do
    @previous_webhook.nil? ? ENV.delete("EMAIL_DELIVERY_WEBHOOK") : ENV["EMAIL_DELIVERY_WEBHOOK"] = @previous_webhook
  end

  test "musician day 1: sends only when the musician has no portfolio items" do
    with_no_link = create_musician(created_at: 1.day.ago)
    with_link = create_musician(created_at: 1.day.ago)
    with_link.portfolio_items.create!(title: "Demo", kind: "audio", url: "https://example.com/a")

    LifecycleSequences.run

    assert LifecycleEmail.sent?(with_no_link, "musician_day1_first_link")
    assert_enqueued_with(job: LifecycleEmailDeliveryJob, args: [with_no_link.id, "musician_day1_first_link"])
    assert_not LifecycleEmail.sent?(with_link, "musician_day1_first_link")
  end

  test "musician day 1 is idempotent across repeated hourly runs" do
    musician = create_musician(created_at: 1.day.ago)
    LifecycleSequences.run
    LifecycleSequences.run
    assert_equal 1, LifecycleEmail.where(user: musician, key: "musician_day1_first_link").count
  end

  test "musician day 3: sends only with no verification request" do
    requested = create_musician(created_at: 3.days.ago)
    requested.verification_requests.create!(kind: "professional")
    clean = create_musician(created_at: 3.days.ago)

    LifecycleSequences.run

    assert_not LifecycleEmail.sent?(requested, "musician_day3_verified_badge")
    assert LifecycleEmail.sent?(clean, "musician_day3_verified_badge")
  end

  test "musician day 5: sends only when availability is blank" do
    set = create_musician(created_at: 5.days.ago)
    set.profile.update!(availability: "Weekends")
    blank = create_musician(created_at: 5.days.ago)

    LifecycleSequences.run

    assert_not LifecycleEmail.sent?(set, "musician_day5_set_availability")
    assert LifecycleEmail.sent?(blank, "musician_day5_set_availability")
  end

  test "musician day 10: sends only when every rate field is nil" do
    priced = create_musician(created_at: 10.days.ago)
    priced.profile.update!(hourly_rate: 1_500)
    unpriced = create_musician(created_at: 10.days.ago)

    LifecycleSequences.run

    assert_not LifecycleEmail.sent?(priced, "musician_day10_add_rates")
    assert LifecycleEmail.sent?(unpriced, "musician_day10_add_rates")
  end

  test "musician day 21 inactive: skipped when there are no matching open requests, sent with real counts otherwise" do
    inactive_no_requests = create_musician(created_at: 30.days.ago, last_login_at: 20.days.ago, city: "Nowhereville")
    inactive_with_requests = create_musician(created_at: 30.days.ago, last_login_at: 20.days.ago, city: "Chennai")
    employer = User.create!(name: "Req Employer", email: "req-employer-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "employer", status: "active")
    UrgentRequest.create!(requester: employer, title: "Need a drummer", role_name: "Drummer", city: "Chennai",
      currency: "INR", status: "open", start_at: 1.day.from_now)

    LifecycleSequences.run

    assert_not LifecycleEmail.sent?(inactive_no_requests, "musician_day21_inactive_requests")
    assert LifecycleEmail.sent?(inactive_with_requests, "musician_day21_inactive_requests")
    assert_enqueued_with(job: LifecycleEmailDeliveryJob, args: [inactive_with_requests.id, "musician_day21_inactive_requests", { count: 1, city: "Chennai" }])
  end

  test "musician day 21 inactive is a no-op for an active musician" do
    active = create_musician(created_at: 30.days.ago, last_login_at: 1.day.ago)
    LifecycleSequences.run
    assert_not LifecycleEmail.sent?(active, "musician_day21_inactive_requests")
  end

  test "hirer day 1: sends only with zero jobs and zero urgent requests" do
    posted = create_hirer(created_at: 1.day.ago)
    Job.create!(employer: posted, title: "Gig", company: posted.name, location: "Mumbai", kind: "Contract", genre: "Pop",
      description: "A properly documented professional opportunity with clear responsibilities and terms.", status: "draft")
    clean = create_hirer(created_at: 1.day.ago)

    LifecycleSequences.run

    assert_not LifecycleEmail.sent?(posted, "hirer_day1_post_or_urgent")
    assert LifecycleEmail.sent?(clean, "hirer_day1_post_or_urgent")
  end

  test "hirer day 7: sends the applicant count only for a published job with an unviewed applicant" do
    hirer = create_hirer(created_at: 7.days.ago)
    job = Job.create!(employer: hirer, title: "Bassist wanted", company: hirer.name, location: "Mumbai", kind: "Contract",
      genre: "Pop", description: "A properly documented professional opportunity with clear responsibilities and terms.", status: "published")
    candidate = create_musician(created_at: 7.days.ago)
    Application.create!(job:, candidate:)

    LifecycleSequences.run

    assert LifecycleEmail.sent?(hirer, "hirer_day7_listing_applicants")
    assert_enqueued_with(job: LifecycleEmailDeliveryJob, args: [hirer.id, "hirer_day7_listing_applicants", { title: job.title, count: 1 }])
  end

  test "hirer day 7 does not send when there is no published job with an unviewed applicant" do
    hirer = create_hirer(created_at: 7.days.ago)
    LifecycleSequences.run
    assert_not LifecycleEmail.sent?(hirer, "hirer_day7_listing_applicants")
    assert_no_enqueued_jobs(only: LifecycleEmailDeliveryJob)
  end

  test "with no email provider nothing is claimed, so the step can still send once one is configured" do
    musician = create_musician(created_at: 1.day.ago)
    ENV.delete("EMAIL_DELIVERY_WEBHOOK")

    LifecycleSequences.run

    assert_not LifecycleEmail.sent?(musician, "musician_day1_first_link")
    assert_no_enqueued_jobs(only: LifecycleEmailDeliveryJob)

    ENV["EMAIL_DELIVERY_WEBHOOK"] = "https://email-hook.example.invalid/send"
    LifecycleSequences.run
    assert LifecycleEmail.sent?(musician, "musician_day1_first_link")
  end

  test "an unverified address or a category opt-out is not claimed either" do
    unverified = create_musician(created_at: 1.day.ago)
    unverified.update!(email_verified: false)
    opted_out = create_musician(created_at: 1.day.ago)
    opted_out.profile.update!(email_preferences: opted_out.profile.email_preferences.merge("lifecycle" => false))

    LifecycleSequences.run

    assert_not LifecycleEmail.sent?(unverified, "musician_day1_first_link")
    assert_not LifecycleEmail.sent?(opted_out, "musician_day1_first_link")
  end

  test "lifecycle:release_undelivered deletes step rows claimed since a time, keeping digests and older rows" do
    Rails.application.load_tasks unless Rake::Task.task_defined?("lifecycle:release_undelivered")
    musician = create_musician(created_at: 30.days.ago)
    burned = LifecycleEmail.create!(user: musician, key: "musician_day1_first_link", sent_at: 1.day.ago)
    LifecycleEmail.create!(user: musician, key: "musician_day3_verified_badge", sent_at: 10.days.ago)
    LifecycleEmail.create!(user: musician, key: LifecycleEmail.digest_key, sent_at: 1.day.ago)

    ENV["SINCE"] = 3.days.ago.iso8601
    task = Rake::Task["lifecycle:release_undelivered"]
    out, = capture_io { task.execute }
    assert_match(/Released 1 /, out)
    assert_not LifecycleEmail.exists?(burned.id)
    assert_equal 2, LifecycleEmail.where(user: musician).count
  ensure
    ENV.delete("SINCE")
  end

  test "lifecycle:release_undelivered with PAIRS releases only the named user and key" do
    Rails.application.load_tasks unless Rake::Task.task_defined?("lifecycle:release_undelivered")
    first = create_musician(created_at: 30.days.ago)
    second = create_musician(created_at: 30.days.ago)
    burned = LifecycleEmail.create!(user: first, key: "musician_day1_first_link", sent_at: 1.day.ago)
    delivered = LifecycleEmail.create!(user: second, key: "musician_day1_first_link", sent_at: 1.day.ago)

    ENV["SINCE"] = 3.days.ago.iso8601
    ENV["PAIRS"] = "#{first.id}:musician_day1_first_link"
    out, = capture_io { Rake::Task["lifecycle:release_undelivered"].execute }
    assert_match(/Released 1 /, out)
    assert_not LifecycleEmail.exists?(burned.id)
    assert LifecycleEmail.exists?(delivered.id)
  ensure
    ENV.delete("SINCE")
    ENV.delete("PAIRS")
  end

  private

  def create_musician(created_at:, last_login_at: nil, city: nil)
    @seq += 1
    user = User.create!(name: "Musician #{@seq}", email: "musician-#{@seq}-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "jobseeker", status: "active", email_verified: true, last_login_at:)
    user.update_column(:created_at, created_at)
    user.create_profile!(location: city)
    user
  end

  def create_hirer(created_at:, last_login_at: nil)
    @seq += 1
    user = User.create!(name: "Hirer #{@seq}", email: "hirer-#{@seq}-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "employer", status: "active", email_verified: true, last_login_at:)
    user.update_column(:created_at, created_at)
    user.create_profile!
    user
  end
end
