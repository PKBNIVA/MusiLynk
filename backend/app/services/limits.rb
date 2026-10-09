# config/limits.yml through Settings: product limits and page sizes. Each reader is a named
# method so a call site says what the number means (Limits.max_live_sessions, never a literal).
module Limits
  module_function

  def config = Settings.load(:limits)

  def max_live_sessions = config.dig(:auth, :max_live_sessions)
  def public_portfolio_items_shown = config.dig(:portfolio, :public_items_shown)
  def portfolios_per_owner = config.dig(:portfolio, :max_per_owner)
  def list_page_size = config.dig(:paging, :list_page_size)
  def list_max_page_size = config.dig(:paging, :list_max_page_size)
  def admin_page_size = config.dig(:paging, :admin_page_size)
  def admin_max_page_size = config.dig(:paging, :admin_max_page_size)
  def search_max_results = config.dig(:search, :max_results)
  def message_max_length = config.dig(:messages, :max_length)
  def job_max_roles = config.dig(:jobs, :max_roles)
  def push_subscriptions_per_user = config.dig(:push, :max_subscriptions_per_user)

  # The limits the frontend mirrors (GET /api/public/config `limits`).
  def public_json
    { maxLiveSessions: max_live_sessions, publicPortfolioItemsShown: public_portfolio_items_shown, portfoliosPerOwner: portfolios_per_owner,
      listPageSize: list_page_size, listMaxPageSize: list_max_page_size, adminPageSize: admin_page_size, adminMaxPageSize: admin_max_page_size,
      searchMaxResults: search_max_results, messageMaxLength: message_max_length, jobMaxRoles: job_max_roles, pushSubscriptionsPerUser: push_subscriptions_per_user }
  end
end
