# assert_queries_at_most(n) { request }: fails when the block runs more than `n` SQL statements.
#
# Counts what reaches the database: schema lookups, transaction statements (BEGIN, SAVEPOINT, ...)
# and query-cache hits are not counted. The query cache is cleared first, because the transactional
# test connection keeps it across requests and a repeated request would otherwise look free.
# Budgets are the counts measured when the budget was set (docs/PERFORMANCE.md); raise one only in
# a change whose purpose is that growth, and say why next to the number.
module QueryBudget
  IGNORED_NAMES = %w[SCHEMA TRANSACTION].freeze
  TRANSACTION_SQL = /\A\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/i

  def assert_queries_at_most(budget, message = nil, &block)
    sqls = capture_queries(&block)
    detail = sqls.each_with_index.map { |sql, index| "  #{index + 1}. #{sql.squish.first(160)}" }.join("\n")
    assert sqls.size <= budget, "#{message || 'block'}: #{sqls.size} queries, budget #{budget}\n#{detail}"
    sqls.size
  end

  def capture_queries
    ActiveRecord::Base.lease_connection.clear_query_cache
    sqls = []
    counter = lambda do |*, payload|
      next if payload[:cached] || IGNORED_NAMES.include?(payload[:name]) || payload[:sql].match?(TRANSACTION_SQL)
      sqls << payload[:sql]
    end
    ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { yield }
    sqls
  end
end
