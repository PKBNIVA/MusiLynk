require "test_helper"

class JobsDeadlineSweepJobTest < ActiveSupport::TestCase
  setup do
    @employer = User.create!(name: "Employer", email: "deadline-employer@example.com", password: "StrongPass123!", role: "employer", status: "active")
  end

  def build_job(status:, deadline:)
    Job.create!(employer: @employer, title: "Guitarist", company: "Band Co", location: "Mumbai", kind: "gig", genre: "rock",
      description: "A" * 80, status:, application_deadline: deadline, published_at: Time.current)
  end

  test "closes a published job past its deadline and notifies the employer once" do
    job = build_job(status: "published", deadline: 1.hour.ago)
    JobsDeadlineSweepJob.perform_now
    assert_equal "closed", job.reload.status
    assert_equal 1, Notification.where(user: @employer, kind: "job_deadline_closed").count

    JobsDeadlineSweepJob.perform_now
    assert_equal 1, Notification.where(user: @employer, kind: "job_deadline_closed").count
  end

  test "leaves a published job whose deadline has not passed" do
    job = build_job(status: "published", deadline: 1.hour.from_now)
    JobsDeadlineSweepJob.perform_now
    assert_equal "published", job.reload.status
  end

  test "leaves a published job with no deadline" do
    job = build_job(status: "published", deadline: nil)
    JobsDeadlineSweepJob.perform_now
    assert_equal "published", job.reload.status
  end

  test "does not touch a job that is not published" do
    job = build_job(status: "draft", deadline: 1.hour.ago)
    JobsDeadlineSweepJob.perform_now
    assert_equal "draft", job.reload.status
  end
end
