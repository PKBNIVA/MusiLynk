require "test_helper"

class AiPricingTest < ActiveSupport::TestCase
  test "enabled_tasks is exactly the launch allow-list, and task_enabled? matches it" do
    assert_equal %w[profile_headline profile_bio job_description job_screening_questions].sort, AiPricing.enabled_tasks.sort
    assert AiPricing.task_enabled?("profile_headline")
    assert AiPricing.task_enabled?("job_description")
    assert_not AiPricing.task_enabled?("cover_letter")
    assert_not AiPricing.task_enabled?("classify_portfolio_item")
    assert_not AiPricing.task_enabled?("not_a_task")
  end

  test "talent_tasks and hirer_tasks partition enabled_tasks" do
    assert_equal %w[profile_headline profile_bio], AiPricing.talent_tasks
    assert_equal %w[job_description job_screening_questions], AiPricing.hirer_tasks
    assert_empty AiPricing.talent_tasks & AiPricing.hirer_tasks
  end

  test "launch limits come from config" do
    assert_equal 5, AiPricing.talent_lifetime_limit
    assert_equal 10, AiPricing.hirer_monthly_limit
  end

  test "the launch budgets are both set to the same ₹1,500 monthly cap" do
    assert_equal 1500, AiPricing.budgets.fetch(:free_tier_monthly_budget_inr)
    assert_equal 1500, AiPricing.budgets.fetch(:hard_monthly_budget_inr)
  end

  test "billing_enabled? reads AI_BILLING_ENABLED, off by default" do
    with_env("AI_BILLING_ENABLED" => nil) { assert_not AiPricing.billing_enabled? }
    with_env("AI_BILLING_ENABLED" => "true") { assert AiPricing.billing_enabled? }
    with_env("AI_BILLING_ENABLED" => "false") { assert_not AiPricing.billing_enabled? }
  end

  test "public_catalogue omits aiPlus/topups while billing is disabled, and includes them once enabled" do
    with_env("AI_BILLING_ENABLED" => nil) do
      catalogue = AiPricing.public_catalogue
      assert_not catalogue.key?(:aiPlus)
      assert_not catalogue.key?(:topups)
      assert_not catalogue.key?(:topupExpiresAfterMonths)
      assert catalogue.key?(:freeCreditsPerMonth)
      assert catalogue.key?(:planAllowances)
      assert catalogue.key?(:taskCosts)
    end

    with_env("AI_BILLING_ENABLED" => "true") do
      catalogue = AiPricing.public_catalogue
      assert catalogue.dig(:aiPlus, :priceInr).present?
      assert catalogue.dig(:topups, :small, :credits).present?
    end
  end

  private

  def with_env(values)
    previous = values.keys.to_h { [_1, ENV[_1]] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
