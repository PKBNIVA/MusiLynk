require "test_helper"
require "minitest/mock"
require "open3"
require "socket"
require_relative "../support/sentry_test_support"

class ErrorReporterTest < ActiveSupport::TestCase
  include SentryTestSupport

  class FlakyJob < ApplicationJob
    class Boom < StandardError; end
    class Blip < StandardError; end
    discard_on ArgumentError
    retry_on Boom, attempts: 1, wait: 0
    retry_on Blip, attempts: 3, wait: 0

    def perform(email, sealed_token, mode)
      raise ArgumentError, "bad input for #{email}" if mode == "discard"
      raise Boom, "provider down" if mode == "retry"
      raise Blip, "transient" if mode == "blip"
      raise "unexpected failure" if mode == "crash"
    end
  end

  test "the initializer is inert in tests and without a DSN" do
    refute Sentry.initialized?
    refute ErrorReporter.enabled?
    refute VerseSentry.enabled_by_env?({}, ActiveSupport::EnvironmentInquirer.new("production"))
    refute VerseSentry.enabled_by_env?({ "SENTRY_DSN" => "  " }, ActiveSupport::EnvironmentInquirer.new("production"))
    refute VerseSentry.enabled_by_env?({ "SENTRY_DSN" => SentryTestSupport::DUMMY_DSN }, ActiveSupport::EnvironmentInquirer.new("test"))
    assert VerseSentry.enabled_by_env?({ "SENTRY_DSN" => SentryTestSupport::DUMMY_DSN }, ActiveSupport::EnvironmentInquirer.new("production"))
  end

  test "configuration reads environment, release and a bounded trace rate, and keeps PII collection off" do
    config = Sentry::Configuration.new
    VerseSentry.configure(config, env: {
      "SENTRY_DSN" => SentryTestSupport::DUMMY_DSN, "SENTRY_ENVIRONMENT" => "staging",
      "RAILWAY_GIT_COMMIT_SHA" => "0123456789abcdef", "SENTRY_TRACES_SAMPLE_RATE" => "0.25"
    })
    assert_equal "staging", config.environment
    assert_equal "0123456789abcdef", config.release
    assert_in_delta 0.25, config.traces_sample_rate
    refute config.send_default_pii
    refute config.data_collection.user_info
    refute config.data_collection.queues
    assert_equal [], config.data_collection.http_bodies
    %w[ActiveRecord::RecordNotFound ActiveRecord::RecordInvalid ActionController::RoutingError ActionController::ParameterMissing ActionController::BadRequest].each do |name|
      assert_includes config.excluded_exceptions, name
    end

    assert_in_delta 0.02, VerseSentry.traces_sample_rate(nil), 1e-9, "a small default sample once a DSN is set"
    assert_in_delta 0.02, VerseSentry.traces_sample_rate("  "), 1e-9
    assert_in_delta 0.02, VerseSentry.traces_sample_rate("lots"), 1e-9
    assert_equal 0.0, VerseSentry.traces_sample_rate("0"), "an explicit 0 turns tracing off"
    assert_equal 1.0, VerseSentry.traces_sample_rate("7")
    default = Sentry::Configuration.new
    VerseSentry.configure(default, env: { "SENTRY_DSN" => SentryTestSupport::DUMMY_DSN })
    assert_equal Rails.env.to_s, default.environment
    assert_in_delta 0.02, default.traces_sample_rate, 1e-9
  end

  test "capture is a no-op without a DSN" do
    assert_nil ErrorReporter.capture(RuntimeError.new("boom"), tags: { source: "test" }, userEmail: "a@b.io")
    assert_nil ErrorReporter.set_user(User.new(id: 1, role: "admin"))
  end

  test "capture sends the exception with scrubbed tags and context" do
    with_sentry do
      event = ErrorReporter.capture(RuntimeError.new("delivery to jane@example.com failed"), tags: { source: "email_delivery_failed", template: "verify_email" },
        link: "https://verse.test/verify-email?token=abc123", recipientEmail: "jane@example.com", attempt: 2)
      assert event
      assert_equal 1, sentry_events.size
      payload = sentry_payloads.first
      assert_equal "email_delivery_failed", payload.dig("tags", "source")
      assert_equal "verify_email", payload.dig("tags", "template")
      assert_equal "https://verse.test/verify-email?token=[Filtered]", payload.dig("extra", "link")
      assert_equal "[Filtered]", payload.dig("extra", "recipientEmail")
      assert_equal 2, payload.dig("extra", "attempt")
      assert_match(/\Adelivery to \[email\] failed/, payload.dig("exception", "values", 0, "value"))
      assert_no_match(/jane@example|abc123/, payload.to_json)
    end
  end

  test "an exception already reported (e.g. by after_discard, then GoodJob's thread hook) is sent once" do
    with_sentry do
      error = RuntimeError.new("job exploded")
      ErrorReporter.capture(error, tags: { source: "active_job" })
      GoodJob._on_thread_error(error)
      assert_equal 1, sentry_events.size
    end
  end

  test "expected client errors are never sent" do
    with_sentry do
      assert_nil ErrorReporter.capture(ActiveRecord::RecordNotFound.new("nope"))
      assert_nil ErrorReporter.capture(ActionController::ParameterMissing.new(:name))
      assert_empty sentry_events
    end
  end

  test "reporting never raises into the caller" do
    with_sentry do
      Sentry.stub(:capture_exception, ->(*) { raise IOError, "transport broke" }) do
        assert_nil ErrorReporter.capture(RuntimeError.new("boom"))
      end
    end
  end

  test "discarded, retry-exhausted and crashed jobs report class and id only, never arguments" do
    sealed = "sealed-#{SecureRandom.hex(8)}" # built at runtime so it never appears in source context lines
    with_sentry do
      discarded = FlakyJob.new("artist@example.com", sealed, "discard")
      discarded.perform_now

      exhausted = FlakyJob.new("artist@example.com", sealed, "retry")
      assert_raises(FlakyJob::Boom) { exhausted.perform_now }

      crashed = FlakyJob.new("artist@example.com", sealed, "crash")
      assert_raises(RuntimeError) { crashed.perform_now }

      payloads = sentry_payloads
      assert_equal 3, payloads.size
      assert_equal [discarded.job_id, exhausted.job_id, crashed.job_id], payloads.map { _1.dig("tags", "job_id") }
      payloads.each do |payload|
        assert_equal FlakyJob.name, payload.dig("tags", "job_class")
        assert_equal "active_job", payload.dig("tags", "source")
        assert_equal %w[job_class job_id], payload["extra"].keys.sort
        serialized = payload.to_json
        assert_no_match(/artist@example|#{sealed}/, serialized)
        assert_nil payload.dig("contexts", "active_job", "arguments")
      end
    end
  end

  test "a job that will be retried, or succeeds, is not reported" do
    with_sentry do
      FlakyJob.new("artist@example.com", "sealed", "blip").perform_now
      FlakyJob.new("artist@example.com", "sealed", "ok").perform_now
      assert_empty sentry_events
    end
  end

  REJECTING_SENTRY = <<~'RUBY'.freeze
    require "socket"
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    Thread.new { loop { c = server.accept; (c.readpartial(65_536) rescue nil); c.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); c.close } }
    Sentry.init { |config| VerseSentry.configure(config, env: { "SENTRY_DSN" => "http://pub@127.0.0.1:#{port}/1", "SENTRY_TRACES_SAMPLE_RATE" => "0" }) }
    Sentry.capture_message("task finished")
    # A failed send leaves a client report that the SDK's at_exit hook flushes (this is what raised).
    Sentry.get_current_client.transport.record_lost_event(:network_error, "error")
    puts "task done"
  RUBY

  test "the SDK is configured with a transport that logs delivery failures instead of raising" do
    config = Sentry::Configuration.new
    VerseSentry.configure(config, env: { "SENTRY_DSN" => SentryTestSupport::DUMMY_DSN })
    assert_equal VerseSentry::Transport, config.transport.transport_class
  end

  test "a rejected DSN (403) is logged, not raised, from send_data and flush" do
    server = TCPServer.new("127.0.0.1", 0)
    port = server.addr[1]
    thread = Thread.new do
      loop do
        client = server.accept
        (client.readpartial(65_536) rescue nil)
        client.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        client.close
      end
    end
    config = Sentry::Configuration.new
    config.dsn = "http://pub@127.0.0.1:#{port}/1"
    config.sdk_logger = ::Logger.new(nil)
    transport = VerseSentry::Transport.new(config)
    io = StringIO.new
    original = Rails.logger
    Rails.logger = ActiveSupport::Logger.new(io)
    begin
      assert_nothing_raised { transport.send_data("{}") }
      transport.record_lost_event(:network_error, "error")
      assert_nothing_raised { transport.flush }
    ensure
      Rails.logger = original
      thread.kill
      server.close
    end
    assert_includes io.string, "sentry_delivery_failed"
    assert_includes io.string, "Sentry::ExternalError"
    assert_not_includes io.string, "pub@"
  end

  test "a rails runner task exits 0 when Sentry rejects its events" do
    output, status = Open3.capture2e({ "RAILS_ENV" => "test" }, Rails.root.join("bin/rails").to_s, "runner", REJECTING_SENTRY, chdir: Rails.root.to_s)
    assert_includes output, "task done"
    assert status.success?, "exit status #{status.exitstatus}: #{output.lines.last(6).join}"
    assert_not_includes output, "ExternalError"
  end
end
