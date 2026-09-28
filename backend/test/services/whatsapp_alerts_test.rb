require "test_helper"

class WhatsappAlertsTest < ActiveSupport::TestCase
  FakeClient = Struct.new(:calls) do
    def initialize
      super([])
    end

    def post(url, headers:, body:, open_timeout:, read_timeout:)
      calls << { url:, headers:, body:, open_timeout:, read_timeout: }
      [200, { messages: [{ id: "wamid.123" }] }.to_json]
    end
  end

  setup do
    @user = User.create!(name: "Ready Musician", email: "wa-musician@example.com", password: "StrongPass123!",
      role: "jobseeker", status: "active", email_verified: true)
    @user.create_profile!(headline: "Drummer", location: "Mumbai", phone_e164: "+919812345678", whatsapp_consented_at: Time.current)
    @request = UrgentRequest.create!(requester: create_hirer, title: "Drummer needed", role_name: "Drummer",
      city: "Mumbai", start_at: 1.day.from_now, currency: "INR", status: "open")
  end

  test "off by default: no env configured" do
    with_env(WHATSAPP_ENABLED: nil, WHATSAPP_ACCESS_TOKEN: nil, WHATSAPP_PHONE_NUMBER_ID: nil, WHATSAPP_TEMPLATE_URGENT: nil) do
      assert_not WhatsappAlerts.enabled?
      result = WhatsappAlerts.send_urgent_alert(@request, @user)
      assert_equal({ sent: false, reason: "not_configured" }, result)
    end
  end

  test "off when only some env vars are set" do
    with_env(WHATSAPP_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: nil, WHATSAPP_TEMPLATE_URGENT: "urgent_request_alert") do
      assert_not WhatsappAlerts.enabled?
    end
  end

  test "not eligible without a phone number and consent" do
    @user.profile.update!(phone_e164: nil, whatsapp_consented_at: nil)
    with_full_config do
      assert_not WhatsappAlerts.eligible?(@user)
      result = WhatsappAlerts.send_urgent_alert(@request, @user)
      assert_equal({ sent: false, reason: "not_eligible" }, result)
    end
  end

  test "not eligible with a phone number but no consent" do
    @user.profile.update!(whatsapp_consented_at: nil)
    with_full_config do
      assert_not WhatsappAlerts.eligible?(@user)
    end
  end

  test "sends a template message with the role, city and time, never logging the token or full number" do
    with_full_config do
      client = FakeClient.new
      logs = capture_logs { WhatsappAlerts.send_urgent_alert(@request, @user, client:) }
      assert_equal 1, client.calls.size
      call = client.calls.first
      assert_equal "https://graph.facebook.com/v20.0/PNID123/messages", call[:url]
      assert_equal "Bearer secret-token", call[:headers]["Authorization"]
      assert_equal 5, call[:open_timeout]
      assert_equal 5, call[:read_timeout]
      body = JSON.parse(call[:body])
      assert_equal "919812345678", body["to"]
      assert_equal "urgent_request_alert", body.dig("template", "name")
      params = body.dig("template", "components", 0, "parameters").map { _1["text"] }
      assert_equal "Drummer", params[0]
      assert_equal "Mumbai", params[1]
      assert_not_includes logs, "secret-token"
      assert_not_includes logs, "919812345678"
      assert_includes logs, "5678"
    end
  end

  test "a non-2xx response raises so the job can retry, and never logs the token" do
    with_full_config do
      failing = Object.new.tap { |c| c.define_singleton_method(:post) { |*| [500, "server error"] } }
      logs = capture_logs do
        assert_raises(WhatsappAlerts::Error) { WhatsappAlerts.send_urgent_alert(@request, @user, client: failing) }
      end
      assert_not_includes logs, "secret-token"
    end
  end

  private

  def with_full_config
    with_env(WHATSAPP_ENABLED: "true", WHATSAPP_ACCESS_TOKEN: "secret-token", WHATSAPP_PHONE_NUMBER_ID: "PNID123",
      WHATSAPP_TEMPLATE_URGENT: "urgent_request_alert") { yield }
  end

  def create_hirer
    User.create!(name: "Hirer", email: "wa-hirer-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!",
      role: "employer", status: "active", email_verified: true).tap { _1.create_profile!(company_name: "Studio") }
  end

  def with_env(values)
    old = values.to_h { |key, _| [key.to_s, ENV[key.to_s]] }
    values.each { |key, value| value.nil? ? ENV.delete(key.to_s) : ENV[key.to_s] = value }
    yield
  ensure
    old&.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end

  def capture_logs
    io = StringIO.new
    previous = Rails.logger
    Rails.logger = Logger.new(io)
    yield
    io.string
  ensure
    Rails.logger = previous
  end
end
