require "test_helper"

class AiUsageCapTest < ActiveSupport::TestCase
  setup { @user = User.create!(name: "Usage Cap User", email: "usage-cap-user@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", email_verified: true) }

  def usage_row(task:, created_at: Time.current)
    AiCreditLedger.create!(account_type: "user", account_id: @user.id, delta: -1, reason: "usage", task:,
      period: AiCredits.current_period(created_at), created_at:)
  end

  test "talent tasks share one lifetime cap across profile_headline and profile_bio" do
    status = AiUsageCap.for(@user, hirer: false)
    assert_equal({ remaining: 5, limit: 5, period: "lifetime" }, status)

    3.times { usage_row(task: "profile_headline") }
    2.times { usage_row(task: "profile_bio") }
    status = AiUsageCap.for(@user, hirer: false)
    assert_equal 0, status.fetch(:remaining)

    assert_raises(AiUsageCap::Exceeded) { AiUsageCap.check!(@user, task: "profile_headline") }
  end

  test "a lifetime cap never resets across months" do
    5.times { usage_row(task: "profile_headline", created_at: 2.months.ago) }
    status = AiUsageCap.for(@user, hirer: false)
    assert_equal 0, status.fetch(:remaining)
  end

  test "hirer tasks share one monthly cap across job_description and job_screening_questions, and it resets" do
    status = AiUsageCap.for(@user, hirer: true)
    assert_equal({ remaining: 10, limit: 10, period: "month" }, status)

    10.times { usage_row(task: "job_description") }
    assert_equal 0, AiUsageCap.for(@user, hirer: true).fetch(:remaining)
    assert_raises(AiUsageCap::Exceeded) { AiUsageCap.check!(@user, task: "job_screening_questions") }

    # Usage from a past month does not count against this month's cap.
    now = 1.month.from_now
    assert_equal 10, AiUsageCap.for(@user, hirer: true, now:).fetch(:remaining)
  end

  test "check! is a no-op for a task outside both launch groups" do
    assert_nil AiUsageCap.check!(@user, task: "cover_letter")
  end

  test "an exceeded cap carries remaining/limit/period for the 402 body" do
    5.times { usage_row(task: "profile_bio") }
    error = assert_raises(AiUsageCap::Exceeded) { AiUsageCap.check!(@user, task: "profile_headline") }
    assert_equal 0, error.remaining
    assert_equal 5, error.limit
    assert_equal "lifetime", error.period
  end
end
