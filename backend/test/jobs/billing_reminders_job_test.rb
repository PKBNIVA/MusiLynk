require "test_helper"

class BillingRemindersJobTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @user = User.create!(name: "Reminder User", email: "reminder-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "employer", status: "active")
    @today = Date.current
  end

  test "emails a trialing subscription once, 3 days before its trial ends, and never again" do
    sub = Subscription.create!(user: @user, plan_code: "pro", provider: "razorpay", status: "trialing",
      provider_subscription_id: "sub_trial", trial_ends_at: (@today + 3).end_of_day - 1.hour)

    assert_enqueued_jobs 1, only: NotificationEmailJob do
      BillingRemindersJob.perform_now(@today)
    end
    job = enqueued_jobs.find { _1["job_class"] == "NotificationEmailJob" }
    assert_equal [@user.id, "trial_ending_soon"], job["arguments"].first(2)
    assert_equal 1, BillingReminder.where(subscription: sub, kind: "trial_ending").count

    clear_enqueued_jobs
    assert_no_enqueued_jobs do
      BillingRemindersJob.perform_now(@today)
    end
    assert_equal 1, BillingReminder.where(subscription: sub, kind: "trial_ending").count, "never sent twice for the same day"
  end

  test "emails an active subscription once, 3 days before its next renewal, with the amount" do
    sub = Subscription.create!(user: @user, plan_code: "pro", provider: "razorpay", status: "active",
      provider_subscription_id: "sub_active", current_period_end: (@today + 3).end_of_day - 1.hour)

    BillingRemindersJob.perform_now(@today)

    job = enqueued_jobs.find { _1["job_class"] == "NotificationEmailJob" }
    assert_equal [@user.id, "plan_renewing_soon"], job["arguments"].first(2)
    assert_includes job["arguments"][2]["amount"], "2,499"
    assert_equal 1, BillingReminder.where(subscription: sub, kind: "renewal_ending").count
  end

  test "skips an active subscription with no known renewal date" do
    Subscription.create!(user: @user, plan_code: "pro", provider: "razorpay", status: "active",
      provider_subscription_id: "sub_no_period", current_period_end: nil)

    assert_no_enqueued_jobs only: NotificationEmailJob do
      BillingRemindersJob.perform_now(@today)
    end
  end

  test "emails an early access subscription at 7 days and again at 1 day before it ends, each once" do
    sub = Subscription.create!(user: @user, plan_code: "pro", provider: "internal", status: "early_access",
      early_access: true, trial_started_at: 83.days.ago, trial_ends_at: (@today + 7).end_of_day - 1.hour)

    BillingRemindersJob.perform_now(@today)
    assert_equal 1, BillingReminder.where(subscription: sub, kind: "early_access_7d").count
    assert_equal 0, BillingReminder.where(subscription: sub, kind: "early_access_1d").count

    sub.update!(trial_ends_at: (@today + 1).end_of_day - 1.hour)
    BillingRemindersJob.perform_now(@today)
    assert_equal 1, BillingReminder.where(subscription: sub, kind: "early_access_1d").count
  end

  test "the reminder email's cancel link verifies for the subscription's own user" do
    sub = Subscription.create!(user: @user, plan_code: "pro", provider: "razorpay", status: "trialing",
      provider_subscription_id: "sub_link", trial_ends_at: (@today + 3).end_of_day - 1.hour)

    BillingRemindersJob.perform_now(@today)

    job_args = enqueued_jobs.find { _1["job_class"] == "NotificationEmailJob" }["arguments"]
    cancel_url = job_args[2]["path"]
    token = CGI.unescape(cancel_url[/[?&]t=([^&]+)/, 1])
    assert_equal sub.id, BillingCancelToken.subscription_for(token, @user)&.id
  end
end
