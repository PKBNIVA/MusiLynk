require "test_helper"

class UrgentMatchSweepJobTest < ActiveJob::TestCase
  setup do
    @hirer = User.create!(name: "Hirer", email: "ums-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active", email_verified: true, profile_complete: true)
    @musician = User.create!(name: "Ready", email: "ums-musician@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", email_verified: true, profile_complete: true)
    @musician.create_profile!(headline: "Drummer", location: "Mumbai", roles: ["Drummer"], verified: true)
  end

  def build(status: "open", match_status: "pending", created_at: 5.minutes.ago, updated_at: nil)
    item = UrgentRequest.create!(requester: @hirer, title: "Drummer #{SecureRandom.hex(3)}", role_name: "Drummer", city: "Mumbai",
      start_at: 1.day.from_now, currency: "INR", status:)
    item.update_columns(match_status:, created_at:, updated_at: updated_at || created_at)
    item
  end

  test "re-enqueues pending requests older than a minute and stale matching claims" do
    pending = build
    stale = build(match_status: "matching", updated_at: 11.minutes.ago)
    assert_enqueued_jobs 2, only: UrgentMatchJob do
      UrgentMatchSweepJob.perform_now
    end
    assert_enqueued_with(job: UrgentMatchJob, args: [pending.id])
    assert_enqueued_with(job: UrgentMatchJob, args: [stale.id])
  end

  test "ignores fresh, claimed, done and non-open requests" do
    build(created_at: 10.seconds.ago)
    build(match_status: "matching", updated_at: 1.minute.ago)
    build(match_status: "done")
    build(match_status: "skipped")
    %w[closed filled expired cancelled].each { build(status: _1) }
    assert_no_enqueued_jobs(only: UrgentMatchJob) { UrgentMatchSweepJob.perform_now }
  end

  test "caps each run" do
    assert_equal 200, UrgentMatchSweepJob::PER_RUN
    3.times { build }
    UrgentMatchSweepJob.send(:remove_const, :PER_RUN)
    UrgentMatchSweepJob.const_set(:PER_RUN, 2)
    assert_enqueued_jobs 2, only: UrgentMatchJob do
      UrgentMatchSweepJob.perform_now
    end
  ensure
    UrgentMatchSweepJob.send(:remove_const, :PER_RUN)
    UrgentMatchSweepJob.const_set(:PER_RUN, 200)
  end

  test "a row stuck in matching is taken over by the swept job and notifies once" do
    item = build(match_status: "matching", updated_at: 11.minutes.ago)
    perform_enqueued_jobs(only: UrgentMatchJob) { UrgentMatchSweepJob.perform_now }
    assert_equal "done", item.reload.match_status
    assert_equal 1, Notification.where(user: @musician, kind: "urgent_alert").count
    assert_no_enqueued_jobs(only: UrgentMatchJob) { UrgentMatchSweepJob.perform_now }
    UrgentMatchJob.perform_now(item.id)
    assert_equal 1, Notification.where(user: @musician, kind: "urgent_alert").count
  end

  test "is scheduled every five minutes" do
    entry = Rails.application.config.good_job.cron[:urgent_match_sweep]
    assert_equal "*/5 * * * *", entry[:cron]
    assert_equal "UrgentMatchSweepJob", entry[:class]
  end
end
