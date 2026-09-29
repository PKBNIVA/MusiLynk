require "test_helper"

class NotifierMilestonesTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @seq = 0
    clear_enqueued_jobs
  end

  test "milestone_first_application fires once, on the hirer's first application ever" do
    employer = create_user("employer")
    job = create_job(employer)
    candidate = create_user("jobseeker")
    application = Application.create!(job:, candidate:)

    Notifier.milestone_first_application(employer, application)
    assert LifecycleEmail.sent?(employer, "milestone_hirer_first_application")
    assert_enqueued_with(job: LifecycleEmailDeliveryJob, args: [employer.id, "milestone_hirer_first_application",
      { candidate: candidate.name, job: job.title }])

    clear_enqueued_jobs
    second_candidate = create_user("jobseeker")
    second_job = create_job(employer)
    second_application = Application.create!(job: second_job, candidate: second_candidate)
    Notifier.milestone_first_application(employer, second_application)
    assert_no_enqueued_jobs(only: LifecycleEmailDeliveryJob)
  end

  test "milestone_first_urgent_response fires once and reports real elapsed minutes" do
    requester = create_user("employer")
    musician = create_user("jobseeker")
    request = UrgentRequest.create!(requester:, title: "Need a guitarist", role_name: "Guitarist", city: "Mumbai",
      currency: "INR", status: "open", start_at: 1.day.from_now)
    request.update_column(:created_at, 12.minutes.ago)

    Notifier.milestone_first_urgent_response(musician, request)
    assert LifecycleEmail.sent?(musician, "milestone_musician_first_response")
    assert_enqueued_with(job: LifecycleEmailDeliveryJob, args: [musician.id, "milestone_musician_first_response", { minutes: 12 }])

    clear_enqueued_jobs
    Notifier.milestone_first_urgent_response(musician, request)
    assert_no_enqueued_jobs(only: LifecycleEmailDeliveryJob)
  end

  test "milestone_5th_filled_request fires exactly on the 5th filled request, not before or after" do
    requester = create_user("employer")
    4.times { create_filled_request(requester) }
    Notifier.milestone_5th_filled_request(requester)
    assert_not LifecycleEmail.sent?(requester, "milestone_hirer_5th_filled_request")

    create_filled_request(requester)
    Notifier.milestone_5th_filled_request(requester)
    assert LifecycleEmail.sent?(requester, "milestone_hirer_5th_filled_request")

    clear_enqueued_jobs
    create_filled_request(requester)
    Notifier.milestone_5th_filled_request(requester)
    assert_no_enqueued_jobs(only: LifecycleEmailDeliveryJob)
  end

  test "milestone_profile_100_views fires exactly at 100, not before or after" do
    user = create_user("jobseeker")
    Notifier.milestone_profile_100_views(user, 99)
    assert_not LifecycleEmail.sent?(user, "milestone_profile_100_views")

    Notifier.milestone_profile_100_views(user, 100)
    assert LifecycleEmail.sent?(user, "milestone_profile_100_views")

    clear_enqueued_jobs
    Notifier.milestone_profile_100_views(user, 101)
    assert_no_enqueued_jobs(only: LifecycleEmailDeliveryJob)
  end

  private

  def create_user(role)
    @seq += 1
    User.create!(name: "Milestone User #{@seq}", email: "milestone-#{@seq}-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role:, status: "active")
  end

  def create_job(employer)
    Job.create!(employer:, title: "Milestone Gig #{@seq}", company: employer.name, location: "Mumbai", kind: "Contract",
      genre: "Pop", description: "A properly documented professional opportunity with clear responsibilities and terms.", status: "published")
  end

  def create_filled_request(requester)
    responder = create_user("jobseeker")
    request = UrgentRequest.create!(requester:, title: "Filled request", role_name: "Bass", city: "Mumbai",
      currency: "INR", status: "open", start_at: 1.day.from_now)
    UrgentRequestResponse.create!(urgent_request: request, user: responder, status: "available")
    request.update!(status: "filled", filled_by: responder)
  end
end
