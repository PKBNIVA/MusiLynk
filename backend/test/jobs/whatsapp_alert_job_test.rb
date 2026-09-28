require "test_helper"
require "minitest/mock"

class WhatsappAlertJobTest < ActiveSupport::TestCase
  setup do
    @hirer = User.create!(name: "WA Job Hirer", email: "wa-job-hirer@example.com", password: "StrongPass123!",
      role: "employer", status: "active", email_verified: true)
    @musician = User.create!(name: "WA Job Musician", email: "wa-job-musician@example.com", password: "StrongPass123!",
      role: "jobseeker", status: "active", email_verified: true)
    @musician.create_profile!(headline: "Drummer", location: "Mumbai", phone_e164: "+919812345678", whatsapp_consented_at: Time.current)
    @urgent = UrgentRequest.create!(requester: @hirer, title: "Drummer needed", role_name: "Drummer", city: "Mumbai",
      start_at: 1.day.from_now, currency: "INR", status: "open")
  end

  test "logs and returns quietly when the request or user is gone" do
    logs = capture_logs { WhatsappAlertJob.new.perform("missing_request", @musician.id) }
    assert_includes logs, "target_missing"
  end

  test "delegates to WhatsappAlerts and logs when it is not configured" do
    WhatsappAlerts.stub(:send_urgent_alert, { sent: false, reason: "not_configured" }) do
      logs = capture_logs { WhatsappAlertJob.new.perform(@urgent.id, @musician.id) }
      assert_includes logs, "not_configured"
    end
  end

  test "a WhatsappAlerts::Error is retried by GoodJob's retry_on, not swallowed" do
    WhatsappAlerts.stub(:send_urgent_alert, ->(*) { raise WhatsappAlerts::Error, "boom" }) do
      assert_raises(WhatsappAlerts::Error) { WhatsappAlertJob.new.perform(@urgent.id, @musician.id) }
    end
  end

  private

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
