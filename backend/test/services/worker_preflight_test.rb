require "test_helper"
require "minitest/mock"

class WorkerPreflightTest < ActiveSupport::TestCase
  test "waits until pending migrations have been applied" do
    pending = [true, true, false]
    sleeps = []
    preflight = build(migrations_pending: -> { pending.shift }, sleeper: ->(seconds) { sleeps << seconds })

    assert_equal true, preflight.wait_for_migrations
    assert_equal [5, 5], sleeps
  end

  test "stops waiting at the deadline and lets the worker start" do
    now = 0
    preflight = build(env: { "WORKER_MIGRATION_WAIT_SECONDS" => "12" }, migrations_pending: -> { true },
      clock: -> { now }, sleeper: ->(seconds) { now += seconds })

    assert_equal false, preflight.wait_for_migrations
    assert_equal 15, now
  end

  test "refuses to run in production while uploads are on the web service's disk" do
    with_production do
      with_env("AWS_BUCKET" => nil) do
        assert_raises(WorkerPreflight::NotAllowed) { build.ensure_uploads_reachable! }
        assert_nothing_raised { build(env: { "WORKER_ALLOW_DISK_UPLOADS" => "true" }).ensure_uploads_reachable! }
      end
      with_env("AWS_BUCKET" => "verse-uploads") do
        assert_nothing_raised { build.ensure_uploads_reachable! }
      end
    end
  end

  private

  def build(env: {}, migrations_pending: -> { false }, clock: -> { 0 }, sleeper: ->(_) {})
    WorkerPreflight.new(env:, migrations_pending:, clock:, sleeper:, logger: Logger.new(nil))
  end

  def with_production(&)
    Rails.stub(:env, ActiveSupport::EnvironmentInquirer.new("production"), &)
  end

  def with_env(values)
    previous = values.keys.to_h { [_1, ENV[_1]] }
    values.each { |key, value| ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| ENV[key] = value }
  end
end
