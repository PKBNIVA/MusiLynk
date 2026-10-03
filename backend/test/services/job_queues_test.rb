require "test_helper"

# config/job_queues.yml: urgent-hire work has its own GoodJob thread pool.
class JobQueuesTest < ActiveSupport::TestCase
  test "the default pools give urgent its own threads, apart from mail and sweeps" do
    assert_equal "urgent:2;notifications,mailers:2;default,scheduled:1", JobQueues.queue_string(env: {})
    assert_equal 5, JobQueues.thread_count(env: {})
    assert_equal JobQueues.queue_string, Rails.application.config.good_job.queues
  end

  test "GOOD_JOB_QUEUES replaces the pools, and a pool without a count takes GOOD_JOB_MAX_THREADS" do
    env = { "GOOD_JOB_QUEUES" => "urgent:1;*", "GOOD_JOB_MAX_THREADS" => "4" }
    assert_equal "urgent:1;*", JobQueues.queue_string(env:)
    assert_equal 5, JobQueues.thread_count(env:)
  end

  test "urgent-hire matching, alerts, emails and pushes run on the urgent queue; everything else does not" do
    assert_equal "urgent", UrgentMatchJob.new.queue_name
    assert_equal "urgent", UrgentMatchSweepJob.new.queue_name
    assert_equal "urgent", WhatsappAlertJob.new("r", "u").queue_name
    assert_equal "urgent", NotificationEmailJob.new("u", "urgent_request_alert", {}).queue_name
    assert_equal "mailers", NotificationEmailJob.new("u", "new_message", {}).queue_name
    assert_equal "urgent", PushDeliveryJob.new("u", "urgent", {}).queue_name
    assert_equal "mailers", PushDeliveryJob.new("u", "messages", {}).queue_name
    assert_equal "mailers", WeeklyDigestDeliveryJob.new.queue_name
  end
end
