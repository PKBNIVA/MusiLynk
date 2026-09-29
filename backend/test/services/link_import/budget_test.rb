require "test_helper"
require_relative "../../support/showcase_helpers"

class LinkImport::BudgetTest < ActiveSupport::TestCase
  include ShowcaseHelpers

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  test "a signed-in account's remaining runs count down from the lifetime limit and never go negative" do
    user = make_user("Budget Limit User")
    assert_equal LinkImport::Budget::TALENT_LIFETIME_LIMIT, LinkImport::Budget.remaining_for(user)

    LinkImport::Budget.record_spend!(user, cost_inr: 1)
    assert_equal LinkImport::Budget::TALENT_LIFETIME_LIMIT - 1, LinkImport::Budget.remaining_for(user)

    (LinkImport::Budget::TALENT_LIFETIME_LIMIT + 5).times { LinkImport::Budget.record_spend!(user, cost_inr: 1) }
    assert_equal 0, LinkImport::Budget.remaining_for(user)
  end

  test "spend is scoped to the profile_from_links task, separate from the shared AI spend guard" do
    user = make_user("Separate Budget User")
    AiCreditLedger.create!(account_type: "user", account_id: user.id, delta: -1, reason: "usage", task: "profile_headline",
      period: AiCredits.current_period, cost_inr: 500)
    assert LinkImport::Budget.available?

    LinkImport::Budget.record_spend!(user, cost_inr: AiPricing.config.fetch(:profile_import_monthly_budget_inr))
    assert_not LinkImport::Budget.available?
  end

  test "the anonymous per-IP limit is independent per IP and never negative" do
    assert LinkImport::Budget.anonymous_available?("198.51.100.9")
    LinkImport::Budget.record_anonymous!("198.51.100.9")
    assert_not LinkImport::Budget.anonymous_available?("198.51.100.9")
    assert LinkImport::Budget.anonymous_available?("198.51.100.10")
  end
end
