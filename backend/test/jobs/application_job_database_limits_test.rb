require "test_helper"
require "minitest/mock"

class ApplicationJobDatabaseLimitsTest < ActionDispatch::IntegrationTest
  class ProbeJob < ApplicationJob
    cattr_accessor :seen

    def perform(fail: false)
      connection = ActiveRecord::Base.lease_connection
      self.class.seen = [connection.select_value("SHOW statement_timeout"), connection.select_value("SHOW lock_timeout")]
      raise ArgumentError, "probe failure" if fail
    end
  end

  class RequestProbe
    def self.call(_env)
      connection = ActiveRecord::Base.lease_connection
      body = { statementTimeout: connection.select_value("SHOW statement_timeout"), lockTimeout: connection.select_value("SHOW lock_timeout") }
      [200, { "content-type" => "application/json" }, [body.to_json]]
    end
  end

  setup { ProbeJob.seen = nil }

  test "a job runs with the worker limits and the connection returns with the web limits" do
    web = DatabaseSessionSettings.variables(role: :web)
    worker = DatabaseSessionSettings.variables(role: :worker)
    assert_not_equal web, worker

    ProbeJob.perform_now
    assert_equal [worker[:statement_timeout], worker[:lock_timeout]], ProbeJob.seen

    connection = ActiveRecord::Base.lease_connection
    assert_equal web[:statement_timeout], connection.select_value("SHOW statement_timeout")
    assert_equal web[:lock_timeout], connection.select_value("SHOW lock_timeout")

    get_probe
    assert_equal({ "statementTimeout" => web[:statement_timeout], "lockTimeout" => web[:lock_timeout] }, response.parsed_body)
  end

  test "the web limits are restored when the job raises" do
    assert_raises(ArgumentError) { ProbeJob.perform_now(fail: true) }
    assert_equal DatabaseSessionSettings.variables(role: :worker)[:statement_timeout], ProbeJob.seen.first

    get_probe
    assert_equal DatabaseSessionSettings.variables(role: :web)[:statement_timeout], response.parsed_body["statementTimeout"]
  end

  test "a connection whose limits cannot be restored is dropped instead of reused" do
    assert restore_failure_throws_away?(transaction_open: false)
  end

  test "inside a caller's transaction a failed restore leaves the connection to the caller" do
    assert_not restore_failure_throws_away?(transaction_open: true)
  end

  test "nested jobs keep the worker limits until the outer job finishes" do
    outer = Class.new(ApplicationJob) do
      def perform
        ProbeJob.perform_now
        ProbeJob.seen = ActiveRecord::Base.lease_connection.uncached { ActiveRecord::Base.lease_connection.select_value("SHOW statement_timeout") }
      end
    end
    ActiveRecord::Base.cache { outer.perform_now }
    assert_equal DatabaseSessionSettings.variables(role: :worker)[:statement_timeout], ProbeJob.seen
  end

  private

  def restore_failure_throws_away?(transaction_open:)
    connection = ActiveRecord::Base.lease_connection
    thrown_away = false
    calls = 0
    original_execute = connection.method(:execute)
    failing_execute = ->(sql, *args) { (calls += 1) > 2 ? raise(ActiveRecord::ConnectionNotEstablished) : original_execute.call(sql, *args) }
    connection.stub(:transaction_open?, transaction_open) do
      connection.stub(:throw_away!, -> { thrown_away = true }) do
        connection.stub(:execute, failing_execute) do
          DatabaseSessionSettings.with_limits(connection, DatabaseSessionSettings.variables(role: :worker)) { :ran }
        end
      end
    end
    thrown_away
  ensure
    DatabaseSessionSettings.apply(connection, DatabaseSessionSettings.variables(role: :web))
  end

  # A request through the app's own middleware stack and connection handling.
  def get_probe
    with_probe_route { get "/__limits_probe" }
  end

  def with_probe_route
    Rails.application.routes.disable_clear_and_finalize = true
    Rails.application.routes.draw { get "/__limits_probe", to: RequestProbe }
    yield
  ensure
    Rails.application.routes.disable_clear_and_finalize = false
    Rails.application.reload_routes!
  end
end
