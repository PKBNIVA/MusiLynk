require "test_helper"
require "minitest/mock"
require_relative "../support/showcase_helpers"
require_relative "../support/push_helpers"

class PushDeliveryJobTest < ActiveSupport::TestCase
  include ShowcaseHelpers
  include PushHelpers

  PAYLOAD = { "title" => "Urgent: Drummer needed in Pune", "body" => "Tomorrow, 7 pm", "url" => "/jobseeker/urgent" }.freeze

  setup do
    @user = make_user("Push Job Musician")
    @user.create_profile!
    @sub = make_subscription(@user)
  end

  test "sends the payload to each device through the push client and records the success" do
    with_push_env do
      sent = []
      stub = lambda do |**args|
        sent << args
        Net::HTTPCreated.new("1.1", "201", "Created")
      end
      WebPush.stub(:payload_send, stub) do
        PushDeliveryJob.perform_now(@user.id, "urgent", PAYLOAD)
      end
      assert_equal 1, sent.size
      assert_equal @sub.endpoint, sent.first[:endpoint]
      assert_equal PAYLOAD, JSON.parse(sent.first[:message])
      assert_equal "high", sent.first[:urgency]
      assert_equal "mailto:support@example.com", sent.first[:vapid][:subject]
      assert_not_nil @sub.reload.last_success_at
      assert_equal 0, @sub.failure_count
    end
  end

  test "signs a VAPID header and encrypts the body when talking to the push service (HTTP stubbed)" do
    with_push_env do |key|
      captured = nil
      fake = Object.new
      fake.define_singleton_method(:request) do |req|
        captured = req
        Net::HTTPCreated.new("1.1", "201", "Created")
      end
      %i[use_ssl= ssl_timeout= open_timeout= read_timeout=].each { |m| fake.define_singleton_method(m) { |_| nil } }
      Net::HTTP.stub(:new, fake) { PushDeliveryJob.perform_now(@user.id, "urgent", PAYLOAD) }

      assert_equal "aes128gcm", captured["Content-Encoding"]
      assert_equal "high", captured["Urgency"]
      refute_includes captured.body, "Drummer", "the payload is encrypted"
      scheme, rest = captured["Authorization"].split(" ", 2)
      assert_equal "vapid", scheme
      token = rest[/t=([^,]+)/, 1]
      public_key = OpenSSL::PKey::EC.new(WebPush::VapidKey.from_keys(key.public_key, key.private_key).curve.to_der).then { _1 }
      claims, = JWT.decode(token, public_key, true, algorithm: "ES256")
      assert_equal "mailto:support@example.com", claims["sub"]
      assert_equal "https://fcm.googleapis.com", claims["aud"]
      assert_equal key.public_key.delete("="), rest[/k=(.+)/, 1].delete("=")
    end
  end

  test "deletes the subscription when the push service says it is gone (404 or 410)" do
    with_push_env do
      [WebPush::ExpiredSubscription, WebPush::InvalidSubscription].each do |error|
        sub = make_subscription(@user)
        response = Struct.new(:body, :inspect).new("gone", "gone")
        WebPush.stub(:payload_send, ->(**) { raise error.new(response, "fcm.googleapis.com") }) do
          PushDeliveryJob.perform_now(@user.id, "urgent", PAYLOAD)
        end
        refute PushSubscription.exists?(sub.id), error.name
        @sub = make_subscription(@user)
      end
    end
  end

  test "a transient failure is counted, the device backs off, and it is dropped after repeated failures" do
    with_push_env do
      calls = 0
      WebPush.stub(:payload_send, ->(**) { calls += 1; raise Timeout::Error }) do
        PushDeliveryJob.perform_now(@user.id, "urgent", PAYLOAD)
        assert_equal 1, @sub.reload.failure_count
        assert_not_nil @sub.last_failure_at

        PushDeliveryJob.perform_now(@user.id, "urgent", PAYLOAD)
        assert_equal 1, calls, "skipped while backing off"

        @sub.update_columns(last_failure_at: 10.minutes.ago)
        PushDeliveryJob.perform_now(@user.id, "urgent", PAYLOAD)
        assert_equal 2, calls
        assert_equal 2, @sub.reload.failure_count

        @sub.update_columns(failure_count: PushSubscription::MAX_FAILURES - 1, last_failure_at: 1.day.ago)
        PushDeliveryJob.perform_now(@user.id, "urgent", PAYLOAD)
        refute PushSubscription.exists?(@sub.id)
      end
    end
  end

  test "a success after failures clears the back-off" do
    with_push_env do
      @sub.update_columns(failure_count: 2, last_failure_at: 1.hour.ago)
      WebPush.stub(:payload_send, ->(**) { Net::HTTPCreated.new("1.1", "201", "Created") }) do
        PushDeliveryJob.perform_now(@user.id, "urgent", PAYLOAD)
      end
      assert_equal 0, @sub.reload.failure_count
    end
  end

  test "respects the preference at send time and sends nothing when push is unconfigured" do
    sent = 0
    with_push_env do
      @user.profile.update!(push_preferences: { "messages" => false })
      WebPush.stub(:payload_send, ->(**) { sent += 1 }) do
        PushDeliveryJob.perform_now(@user.id, "messages", PAYLOAD)
        @user.profile.update!(push_preferences: { "urgent" => false })
        PushDeliveryJob.perform_now(@user.id, "urgent", PAYLOAD)
      end
    end
    with_push_env(enabled: false) do
      WebPush.stub(:payload_send, ->(**) { sent += 1 }) { PushDeliveryJob.perform_now(@user.id, "urgent", PAYLOAD) }
    end
    assert_equal 0, sent
  end

  test "a missing user is ignored" do
    with_push_env { assert_nil PushDeliveryJob.perform_now("user_missing", "urgent", PAYLOAD) }
  end

  test "the logs never contain the endpoint, keys or text" do
    with_push_env do
      io = StringIO.new
      @previous_logger = Rails.logger
      Rails.logger = Logger.new(io)
      WebPush.stub(:payload_send, ->(**) { raise Timeout::Error }) { PushDeliveryJob.perform_now(@user.id, "urgent", PAYLOAD) }
      Rails.logger = @previous_logger
      refute_includes io.string, @sub.endpoint
      refute_includes io.string, "Drummer"
      assert_includes io.string, "push_delivery"
    end
  ensure
    Rails.logger = @previous_logger if @previous_logger
  end
end
