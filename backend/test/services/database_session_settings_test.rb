require "test_helper"

class DatabaseSessionSettingsTest < ActiveSupport::TestCase
  test "web connections run with the statement and lock timeouts from database.yml" do
    assert_equal :web, DatabaseSessionSettings.current_role
    expected = DatabaseSessionSettings.variables
    assert_not_equal "0", expected[:statement_timeout]

    connection = ActiveRecord::Base.lease_connection
    assert_equal expected[:statement_timeout], connection.select_value("SHOW statement_timeout")
    assert_equal expected[:lock_timeout], connection.select_value("SHOW lock_timeout")
  end

  test "a query running past statement_timeout is cancelled" do
    connection = ActiveRecord::Base.lease_connection
    connection.transaction(requires_new: true) do
      # Same mechanism as the session setting, scoped to this transaction to keep the test fast.
      connection.execute("SET LOCAL statement_timeout = '50ms'")
      assert_raises(ActiveRecord::QueryCanceled) { connection.execute("SELECT pg_sleep(1)") }
      raise ActiveRecord::Rollback
    end
  end

  test "defaults per process kind" do
    assert_equal({ statement_timeout: "15s", lock_timeout: "5s" }, DatabaseSessionSettings.variables(env: {}, role: :web))
    assert_equal({ statement_timeout: "5min", lock_timeout: "30s" }, DatabaseSessionSettings.variables(env: {}, role: :worker))
    assert_equal({ statement_timeout: "0", lock_timeout: "0" }, DatabaseSessionSettings.variables(env: {}, role: :migration))
  end

  test "limits are env-overridable and malformed values fall back to the default" do
    env = { "DB_STATEMENT_TIMEOUT" => "30s", "DB_LOCK_TIMEOUT" => "2s; RESET ALL" }
    assert_equal({ statement_timeout: "30s", lock_timeout: "5s" }, DatabaseSessionSettings.variables(env:, role: :web))
    assert_equal "0", DatabaseSessionSettings.variables(env: { "WORKER_DB_STATEMENT_TIMEOUT" => "0" }, role: :worker)[:statement_timeout]
  end

  test "db tasks get the migration limits and the GoodJob CLI gets the worker limits" do
    assert_equal :migration, DatabaseSessionSettings.current_role(rake_tasks: ["db:prepare"], good_job_cli: false)
    assert_equal :migration, DatabaseSessionSettings.current_role(rake_tasks: ["db:migrate"], good_job_cli: true)
    assert_equal :worker, DatabaseSessionSettings.current_role(rake_tasks: [], good_job_cli: true)
    assert_equal :web, DatabaseSessionSettings.current_role(rake_tasks: ["worker:preflight"], good_job_cli: false)
  end
end
