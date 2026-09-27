require "test_helper"
require "minitest/mock"

class ReadinessChecksTest < ActiveSupport::TestCase
  test "database readiness executes a real query" do
    queried = false
    connection = fake_connection { |sql| queried = sql == "SELECT 1"; 1 }

    checks = ReadinessChecks.new(connection_provider: -> { connection }).call
    assert queried
    assert_equal true, checks.dig(:database, :ok)
  end

  test "database query failure makes core readiness fail" do
    connection = fake_connection { raise ActiveRecord::ConnectionNotEstablished }

    checker = ReadinessChecks.new(connection_provider: -> { connection })
    checks = checker.call
    assert_equal false, checks.dig(:database, :ok)
    assert_equal false, checker.core_ready?(checks)
  end

  test "optional integration state does not change core readiness" do
    checker = ReadinessChecks.new
    checks = {
      database: { ok: true, required: true },
      payments: { ok: false, required: false }
    }

    assert checker.core_ready?(checks)
    assert_not checker.optional_integrations_ready?(checks)
  end

  test "Brevo configuration is recognized as email delivery" do
    previous_key = ENV["BREVO_API_KEY"]
    previous_sender = ENV["BREVO_SENDER_EMAIL"]
    ENV["BREVO_API_KEY"] = "test-key"
    ENV["BREVO_SENDER_EMAIL"] = "admin@notify.alienbrains.in"

    checks = ReadinessChecks.new.call
    assert_equal true, checks.dig(:emailDelivery, :ok)
    assert_equal "brevo", checks.dig(:emailDelivery, :provider)
  ensure
    ENV["BREVO_API_KEY"] = previous_key
    ENV["BREVO_SENDER_EMAIL"] = previous_sender
  end

  test "external job execution without a live worker is not ready in production" do
    checks = production_background_jobs("external")
    assert_equal false, checks[:ok]
    assert_equal true, checks[:required]
    assert_equal 0, checks[:activeWorkers]
    assert_nil checks[:lastWorkerHeartbeatAt]
  end

  test "external job execution with a worker heartbeat inside GoodJob's window is ready" do
    GoodJob::Process.create!(state: { "hostname" => "worker" }, lock_type: nil)

    checks = production_background_jobs("external")
    assert_equal true, checks[:ok]
    assert_equal 1, checks[:activeWorkers]
    assert checks[:lastWorkerHeartbeatAt].present?
  end

  test "a worker whose heartbeat expired does not count" do
    GoodJob::Process.create!(state: { "hostname" => "worker" }, lock_type: nil, updated_at: 10.minutes.ago)

    checks = production_background_jobs("external")
    assert_equal false, checks[:ok]
    assert_equal 0, checks[:activeWorkers]
    assert checks[:lastWorkerHeartbeatAt].present?
  end

  test "in-process (async) jobs do not need a separate worker" do
    checks = production_background_jobs("async")
    assert_equal true, checks[:ok]
    assert_not checks.key?(:activeWorkers)
  end

  private

  def production_background_jobs(mode)
    previous_mode = ENV["GOOD_JOB_EXECUTION_MODE"]
    ENV["GOOD_JOB_EXECUTION_MODE"] = mode
    Rails.stub(:env, ActiveSupport::EnvironmentInquirer.new("production")) do
      ActiveJob::Base.stub(:queue_adapter_name, "good_job") do
        ReadinessChecks.new.call.fetch(:backgroundJobs)
      end
    end
  ensure
    ENV["GOOD_JOB_EXECUTION_MODE"] = previous_mode
  end

  def fake_connection(&query)
    Object.new.tap do |connection|
      connection.define_singleton_method(:adapter_name) { "PostgreSQL" }
      connection.define_singleton_method(:transaction) { |**_, &block| block.call }
      connection.define_singleton_method(:execute) { |_sql| true }
      connection.define_singleton_method(:select_value, &query)
    end
  end
end
