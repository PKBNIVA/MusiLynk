require "test_helper"

class AiCreditsTest < ActiveSupport::TestCase
  setup { @user = User.create!(name: "Credits User", email: "credits-user@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", email_verified: true) }

  def resolution_for(user) = AiCreditAccount.for(user)

  test "ensure_monthly_allowance! grants once per account+period and is idempotent under a race" do
    resolution = resolution_for(@user)
    granted = AiCredits.ensure_monthly_allowance!(resolution, hirer: false)
    assert_equal 20, granted
    assert_equal 20, AiCredits.balance(resolution.account_type, resolution.account_id)

    # A second call this period grants nothing more.
    again = AiCredits.ensure_monthly_allowance!(resolution, hirer: false)
    assert_equal 0, again
    assert_equal 20, AiCredits.balance(resolution.account_type, resolution.account_id)
  end

  test "ensure_monthly_allowance! is idempotent under concurrent callers" do
    resolution = resolution_for(@user)
    results = []
    threads = 8.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection { results << AiCredits.ensure_monthly_allowance!(resolution, hirer: false) }
      end
    end
    threads.each(&:join)

    assert_equal 20, results.sum
    assert_equal 20, AiCredits.balance(resolution.account_type, resolution.account_id)
    assert_equal 1, AiCreditLedger.for_account(resolution.account_type, resolution.account_id).where(reason: "monthly_allowance").count
  end

  test "free credits require a verified email; unverified grants nothing" do
    @user.update!(email_verified: false)
    resolution = resolution_for(@user)
    granted = AiCredits.ensure_monthly_allowance!(resolution, hirer: false, email_verified: false)
    assert_equal 0, granted
    assert_equal 0, AiCredits.balance(resolution.account_type, resolution.account_id)
  end

  test "charge! draws allowance before topups, and insufficient balance raises without changing it" do
    resolution = resolution_for(@user)
    AiCredits.ensure_monthly_allowance!(resolution, hirer: false) # 20 credits
    AiCreditLedger.create!(account_type: resolution.account_type, account_id: resolution.account_id, delta: 50, reason: "topup", expires_at: 1.year.from_now)

    AiCredits.charge!(resolution, cost: 15, task: "post_caption")
    assert_equal 5, AiCredits.allowance_pool(resolution.account_type, resolution.account_id)
    assert_equal 50, AiCredits.topup_pool(resolution.account_type, resolution.account_id)

    # Spends the rest of the allowance, then starts drawing on the topup.
    AiCredits.charge!(resolution, cost: 10, task: "post_caption")
    assert_equal 0, AiCredits.allowance_pool(resolution.account_type, resolution.account_id)
    assert_equal 45, AiCredits.topup_pool(resolution.account_type, resolution.account_id)

    before = AiCredits.balance(resolution.account_type, resolution.account_id)
    assert_raises(AiCredits::InsufficientCredits) { AiCredits.charge!(resolution, cost: 1000, task: "post_caption") }
    assert_equal before, AiCredits.balance(resolution.account_type, resolution.account_id)
  end

  test "refund! reverses a charge exactly once" do
    resolution = resolution_for(@user)
    AiCredits.ensure_monthly_allowance!(resolution, hirer: false)
    rows = AiCredits.charge!(resolution, cost: 5, task: "post_caption")
    assert_equal 15, AiCredits.balance(resolution.account_type, resolution.account_id)

    AiCredits.refund!(rows)
    assert_equal 20, AiCredits.balance(resolution.account_type, resolution.account_id)

    # Refunding the same rows again is a no-op.
    AiCredits.refund!(rows)
    assert_equal 20, AiCredits.balance(resolution.account_type, resolution.account_id)
  end

  test "charge! is race-safe: concurrent spends never overdraw the account" do
    resolution = resolution_for(@user)
    AiCredits.ensure_monthly_allowance!(resolution, hirer: false) # 20 credits

    outcomes = []
    mutex = Mutex.new
    threads = 10.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          begin
            AiCredits.charge!(resolution, cost: 3, task: "post_caption")
            mutex.synchronize { outcomes << :ok }
          rescue AiCredits::InsufficientCredits
            mutex.synchronize { outcomes << :insufficient }
          end
        end
      end
    end
    threads.each(&:join)

    assert_equal 6, outcomes.count(:ok) # 20 / 3 = 6 successful charges, then insufficient
    assert_equal 2, AiCredits.balance(resolution.account_type, resolution.account_id)
  end

  test "allowance does not roll over into the next period" do
    resolution = resolution_for(@user)
    AiCredits.ensure_monthly_allowance!(resolution, hirer: false, now: Time.utc(2026, 8, 15))
    assert_equal 20, AiCredits.balance(resolution.account_type, resolution.account_id, now: Time.utc(2026, 8, 20))
    # A new month: the old allowance is gone, and a fresh one is due.
    assert_equal 0, AiCredits.balance(resolution.account_type, resolution.account_id, now: Time.utc(2026, 9, 1))
    granted = AiCredits.ensure_monthly_allowance!(resolution, hirer: false, now: Time.utc(2026, 9, 1))
    assert_equal 20, granted
  end

  test "AiCreditAccount pools a Studio subscriber's credits on their organization" do
    owner = User.create!(name: "Studio Owner", email: "studio-owner@example.com", password: "StrongPass123!", role: "employer", status: "active", email_verified: true)
    org = Organization.create!(owner: owner, name: "Studio Org", status: "active")
    Subscription.create!(user: owner, plan_code: "studio", provider: "internal", status: "active", current_period_end: 1.month.from_now)

    resolution = AiCreditAccount.for(owner)
    assert_equal "organization", resolution.account_type
    assert_equal org.id, resolution.account_id
    assert_equal 2000, AiCreditAccount.monthly_allowance(resolution, hirer: true)
  end
end
