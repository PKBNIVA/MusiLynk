require "test_helper"
require "minitest/mock"

class UrgentMatchJobTest < ActiveJob::TestCase
  setup do
    @hirer = User.create!(name: "Hirer", email: "umj-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active", email_verified: true, profile_complete: true)
    @musician = User.create!(name: "Ready", email: "umj-musician@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", email_verified: true, profile_complete: true)
    @musician.create_profile!(headline: "Drummer", location: "Mumbai", roles: ["Drummer"], verified: true)
    @request = UrgentRequest.create!(requester: @hirer, title: "Drummer needed", role_name: "Drummer", city: "Mumbai",
      start_at: 1.day.from_now, currency: "INR", status: "open")
  end

  test "a new request starts pending" do
    assert_equal "pending", @request.reload.match_status
    assert_nil @request.matched_at
  end

  test "performing matches, notifies and marks the request done" do
    UrgentMatchJob.perform_now(@request.id)
    @request.reload
    assert_equal "done", @request.match_status
    assert_not_nil @request.matched_at
    assert_equal 1, @request.notified_count
    assert Notification.exists?(user: @musician, kind: "urgent_alert")
  end

  test "running it twice alerts once" do
    perform_enqueued_jobs { UrgentMatchJob.perform_now(@request.id) }
    first_emails = enqueued_jobs.size
    assert_no_difference -> { Notification.where(kind: "urgent_alert").count } do
      UrgentMatchJob.perform_now(@request.id)
    end
    assert_equal first_emails, enqueued_jobs.size, "a second run enqueues no more emails or pushes"
    assert_equal 1, @request.reload.notified_count
    assert_equal 1, UrgentRequestNotification.where(urgent_request: @request, channel: "in_app").count
  end

  test "a run that finds the request already claimed does nothing" do
    @request.update_columns(match_status: "matching", updated_at: Time.current)
    assert_no_difference -> { Notification.count } do
      UrgentMatchJob.perform_now(@request.id)
    end
    assert_equal "matching", @request.reload.match_status
  end

  test "a stale claim from a dead worker is taken over" do
    @request.update_columns(match_status: "matching", updated_at: 1.hour.ago)
    UrgentMatchJob.perform_now(@request.id)
    assert_equal "done", @request.reload.match_status
    assert_equal 1, @request.notified_count
  end

  test "cancelled, closed, filled and expired requests are skipped" do
    %w[cancelled closed filled expired].each do |status|
      item = UrgentRequest.create!(requester: @hirer, title: "Drummer #{status}", role_name: "Drummer", city: "Mumbai",
        start_at: 1.day.from_now, currency: "INR", status:)
      assert_no_difference -> { Notification.count } do
        UrgentMatchJob.perform_now(item.id)
      end
      assert_equal "skipped", item.reload.match_status, status
      assert_equal 0, item.notified_count
    end
  end

  test "a failure hands the claim back so a retry can run, and the retry alerts once" do
    boom = ->(*) { raise Net::ReadTimeout }
    UrgentMatcher.stub(:notify!, boom) do
      UrgentMatchJob.perform_now(@request.id)
    end
    assert_equal "pending", @request.reload.match_status
    UrgentMatchJob.perform_now(@request.id)
    assert_equal "done", @request.reload.match_status
    assert_equal 1, UrgentRequestNotification.where(urgent_request: @request, channel: "in_app").count
  end

  test "a deleted request is discarded without raising" do
    id = @request.id
    @request.destroy!
    assert_nothing_raised { UrgentMatchJob.perform_now(id) }
  end

  test "runs on a queue the worker picks up" do
    assert_equal "urgent", UrgentMatchJob.new.queue_name
    assert_includes JobQueues.queue_string.split(";").map { _1.split(":").first.split(",") }.flatten, "urgent"
  end
end
