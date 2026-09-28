require "test_helper"

class AiOrchestratorTest < ActiveSupport::TestCase
  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @user = User.create!(name: "Orchestrator User", email: "orchestrator@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", email_verified: true)
  end

  teardown { Rails.cache = @original_cache }

  def with_ai_enabled(&) = with_env("ANTHROPIC_API_KEY" => "sk-test", &)

  def with_env(values)
    previous = values.keys.to_h { [_1, ENV[_1]] }
    values.each { |k, v| ENV[k] = v }
    yield
  ensure
    previous.each { |k, v| ENV[k] = v }
  end

  test "a cache hit charges credits (non-paid account) but makes no API call" do
    with_ai_enabled do
      calls = 0
      run = -> { AiOrchestrator.run(user: @user, task: "post_caption", context: { kind: "release" }) { calls += 1; { suggestion: "hi", model: "m", task: "post_caption", inputTokens: 10, outputTokens: 5 } } }

      first = run.call
      assert_equal false, first.cached
      assert_equal 1, calls
      assert_equal 19, first.balance

      second = run.call
      assert_equal true, second.cached
      assert_equal 1, calls, "the cache hit must not call the model again"
      assert_equal 18, second.balance, "a cache hit still charges credits for a non-paid account"
    end
  end

  test "regenerate: true bypasses the cache and always calls the model" do
    with_ai_enabled do
      calls = 0
      builder = -> { AiOrchestrator.run(user: @user, task: "post_caption", context: { kind: "release" }, regenerate: true) { calls += 1; { suggestion: "hi #{calls}", model: "m", task: "post_caption", inputTokens: 1, outputTokens: 1 } } }
      builder.call
      builder.call
      assert_equal 2, calls
    end
  end

  test "a provider error refunds the reserved credits" do
    with_ai_enabled do
      balance_before = AiCreditAccount.for(@user).tap { |r| AiCredits.ensure_monthly_allowance!(r, hirer: false) }
      assert_raises(RuntimeError) do
        AiOrchestrator.run(user: @user, task: "post_caption", context: { kind: "release" }) { raise "boom" }
      end
      resolution = AiCreditAccount.for(@user)
      assert_equal 20, AiCredits.balance(resolution.account_type, resolution.account_id)
    end
  end

  test "insufficient credits raises before any model call" do
    with_ai_enabled do
      calls = 0
      # Spend the free allowance down to 0 first.
      resolution = AiCreditAccount.for(@user)
      AiCredits.ensure_monthly_allowance!(resolution, hirer: false)
      AiCredits.charge!(resolution, cost: 20, task: "post_caption")

      assert_raises(AiCredits::InsufficientCredits) do
        AiOrchestrator.run(user: @user, task: "post_caption", context: { kind: "release" }) { calls += 1; { suggestion: "hi", model: "m", task: "post_caption", inputTokens: 1, outputTokens: 1 } }
      end
      assert_equal 0, calls
    end
  end

  test "a paid-plan account is not charged again on a cache hit" do
    with_ai_enabled do
      Subscription.create!(user: @user, plan_code: "pro", provider: "internal", status: "active", current_period_end: 1.month.from_now)
      calls = 0
      run = -> { AiOrchestrator.run(user: @user, task: "post_caption", context: { kind: "release" }) { calls += 1; { suggestion: "hi", model: "m", task: "post_caption", inputTokens: 1, outputTokens: 1 } } }
      first = run.call
      balance_after_first = first.balance
      second = run.call
      assert_equal true, second.cached
      assert_equal 0, second.credits_charged
      assert_equal balance_after_first, second.balance
    end
  end
end
