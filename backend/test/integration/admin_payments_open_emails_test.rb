require "test_helper"
require "minitest/mock"

# "Email members waiting for payments": the admin button behind the "Email me when payments
# open" preference (Profile#payments_notify?). Counts, one email each, preference cleared,
# nobody suppressed or synthetic emailed.
class AdminPaymentsOpenEmailsTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  LIVE = { "RAZORPAY_KEY_ID" => "rzp_test_followups", "RAZORPAY_KEY_SECRET" => "secret-for-tests",
           "EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send", "FRONTEND_URL" => "https://verse.example" }.freeze
  OFF = { "RAZORPAY_KEY_ID" => nil, "RAZORPAY_KEY_SECRET" => nil, "EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send" }.freeze

  setup do
    @admin = create_user("Pay Admin", "pay-admin@example.com", "admin")
    @token = session_for(@admin)
    @waiting = [waiting_user("one"), waiting_user("two")]
  end

  test "only admins can see or send" do
    get "/api/admin/payments-open-email"
    assert_response :unauthorized
    post "/api/admin/payments-open-email", headers: auth(session_for(@waiting.first))
    assert_response :forbidden
  end

  test "shows how many are waiting and how many can be emailed, and whether payments are usable" do
    suppressed = waiting_user("suppressed")
    EmailSuppression.create!(email: suppressed.email, reason: "hard_bounce", scope: "all", last_event: "hard_bounce", last_event_at: Time.current, suppressed_at: Time.current)
    synthetic = waiting_user("synthetic")
    synthetic.update!(synthetic_batch: "demo-batch")
    off = waiting_user("off")
    off.profile.update!(email_notifications: false)
    not_waiting = waiting_user("none")
    not_waiting.profile.update!(email_preferences: {})

    with_env(LIVE) { get "/api/admin/payments-open-email", headers: auth(@token) }
    assert_response :success
    body = response.parsed_body
    assert_equal true, body["usable"]
    assert_equal 4, body["waiting"] # the two, suppressed and notification-off members; not synthetic, not unticked
    assert_equal 2, body["sendable"]

    with_env(OFF) { get "/api/admin/payments-open-email", headers: auth(@token) }
    assert_equal false, response.parsed_body["usable"]
  end

  test "refuses to send while payments are not usable" do
    with_env(OFF) do
      assert_no_enqueued_jobs { post "/api/admin/payments-open-email", headers: auth(@token) }
    end
    assert_response :service_unavailable
    assert_equal "PAYMENTS_NOT_CONFIGURED", response.parsed_body["code"]
    assert(@waiting.all? { _1.profile.reload.payments_notify? })
  end

  test "sends one email each, clears the preference, and a second run sends nothing" do
    sent = []
    with_env(LIVE) do
      Faraday.stub(:post, capture(sent)) do
        perform_enqueued_jobs { post "/api/admin/payments-open-email", headers: auth(@token) }
        assert_response :accepted
        assert_equal 2, sent.size
        perform_enqueued_jobs { post "/api/admin/payments-open-email", headers: auth(@token) }
      end
    end
    assert_equal 2, sent.size, "nobody is emailed twice"
    assert(@waiting.none? { _1.profile.reload.payments_notify? })
    assert_equal 0, PaymentsOpenEmails.waiting
    assert_equal 2, AuditLog.where(action: "admin.payments_open_emails.queue").count
    payload = sent.first.last.to_s
    assert_includes payload, "https://verse.example/pricing"
    assert_not_includes payload, "/jobseeker/pricing"
  end

  test "skips suppressed, synthetic, unverified and notification-off members and leaves their preference alone" do
    suppressed = waiting_user("suppressed")
    EmailSuppression.create!(email: suppressed.email, reason: "hard_bounce", scope: "all", last_event: "hard_bounce", last_event_at: Time.current, suppressed_at: Time.current)
    synthetic = waiting_user("synthetic")
    synthetic.update!(synthetic_batch: "demo-batch")
    unverified = waiting_user("unverified")
    unverified.update!(email_verified: false)
    off = waiting_user("off")
    off.profile.update!(email_notifications: false)

    with_env(LIVE) do
      assert_enqueued_jobs 2, only: NotificationEmailJob do
        result = PaymentsOpenEmails.call
        assert_equal 2, result.sent
        assert_equal 3, result.skipped # suppressed, unverified, notification-off; synthetic is not counted at all
      end
    end
    [suppressed, unverified, off].each { assert _1.profile.reload.payments_notify? }
    assert synthetic.profile.reload.payments_notify?
  end

  test "the job does nothing while payments are not usable" do
    with_env(OFF) do
      assert_no_enqueued_jobs(only: NotificationEmailJob) { PaymentsOpenEmailsJob.perform_now }
    end
    assert(@waiting.all? { _1.profile.reload.payments_notify? })
  end

  test "the email is short, says what changed and has one link to pricing" do
    content = NotificationEmail.render("payments_open", { "path" => "https://verse.example/pricing" }, @waiting.first)
    assert_equal "Payments are now open on Verse", content[:subject]
    assert_equal 1, content[:text].scan("https://verse.example/pricing").size
    assert_includes content[:text], "See pricing: https://verse.example/pricing"
  end

  private

  def create_user(name, email, role)
    User.create!(name:, email:, password: "StrongPass123!", role:, status: "active").tap(&:create_profile!)
  end

  def auth(token) = { "Authorization" => "Bearer #{token}" }

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    raw
  end

  Response = Struct.new(:status, :body) do
    def success? = status.between?(200, 299)
  end
  FakeRequest = Struct.new(:headers, :body, :options)

  def capture(sent)
    lambda do |url, &configure|
      request = FakeRequest.new({}, nil, Struct.new(:open_timeout, :timeout).new)
      configure.call(request)
      sent << [url, JSON.parse(request.body)]
      Response.new(202, "{}")
    end
  end

  def waiting_user(tag)
    user = User.create!(name: "Waiting #{tag}", email: "waiting-#{tag}@example.com", password: "StrongPass123!",
      role: "jobseeker", status: "active", email_verified: true)
    user.create_profile!(email_preferences: { Profile::PAYMENTS_NOTIFY_KEY => true })
    user
  end

  def with_env(values)
    previous = values.keys.index_with { ENV[_1] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
