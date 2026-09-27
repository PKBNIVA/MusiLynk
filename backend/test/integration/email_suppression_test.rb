require "test_helper"
require "minitest/mock"
require Rails.root.join("db/migrate/20260927120000_create_email_suppressions").to_s

class EmailSuppressionTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  SECRET = "brevo-hook-secret-0123456789".freeze
  PATH = "/api/email/webhook/brevo".freeze
  PROVIDER_ENV = { "EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send", "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil }.freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @user = User.create!(name: "Bounce User", email: "bounce@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", email_verified: true)
    @user.create_profile!
  end

  teardown do
    Rails.cache = @original_cache
  end

  # --- authentication ---------------------------------------------------------

  test "the webhook refuses every call when BREVO_WEBHOOK_SECRET is unset" do
    with_env("BREVO_WEBHOOK_SECRET" => nil) do
      post "#{PATH}?token=anything", params: event("hard_bounce").to_json, headers: json
      assert_response :service_unavailable
      assert_equal "WEBHOOK_NOT_CONFIGURED", response.parsed_body["code"]
    end
    assert_equal 0, EmailSuppression.count
  end

  test "the webhook rejects a missing or wrong secret" do
    with_env("BREVO_WEBHOOK_SECRET" => SECRET) do
      post PATH, params: event("hard_bounce").to_json, headers: json
      assert_response :unauthorized
      post "#{PATH}?token=#{SECRET}x", params: event("hard_bounce").to_json, headers: json
      assert_response :unauthorized
      post PATH, params: event("hard_bounce").to_json, headers: json.merge("Authorization" => "Bearer wrong")
      assert_response :unauthorized
      post PATH, params: event("hard_bounce").to_json, headers: json.merge("Authorization" => "Basic #{Base64.strict_encode64('brevo:wrong')}")
      assert_response :unauthorized
      post PATH, params: event("hard_bounce").merge("token" => SECRET).to_json, headers: json
      assert_response :unauthorized, "a secret in the JSON body is not accepted"
    end
    assert_equal 0, EmailSuppression.count
  end

  test "the secret is accepted in the URL, as a bearer token or as the basic-auth password" do
    with_env("BREVO_WEBHOOK_SECRET" => SECRET) do
      post "#{PATH}?token=#{SECRET}", params: event("hard_bounce", email: "a@example.com").to_json, headers: json
      assert_response :success
      post PATH, params: event("hard_bounce", email: "b@example.com").to_json, headers: json.merge("Authorization" => "Bearer #{SECRET}")
      assert_response :success
      post PATH, params: event("hard_bounce", email: "c@example.com").to_json, headers: json.merge("Authorization" => "Basic #{Base64.strict_encode64("brevo:#{SECRET}")}")
      assert_response :success
    end
    assert_equal %w[a@example.com b@example.com c@example.com], EmailSuppression.order(:email).pluck(:email)
  end

  test "a malformed payload is rejected" do
    deliver_raw("not json")
    assert_response :bad_request
    deliver_raw([1, 2].to_json)
    assert_response :bad_request
  end

  # --- event types ------------------------------------------------------------

  test "a hard bounce suppresses every email to the address" do
    deliver(event("hard_bounce", email: " Bounce@Example.com "))
    assert_response :success
    assert_equal 1, response.parsed_body["recorded"]
    row = EmailSuppression.find_by!(email: "bounce@example.com")
    assert_equal %w[all hard_bounce hard_bounce], [row.scope, row.reason, row.last_event]
    assert row.suppressed_at
    assert EmailSuppression.blocks_all?("bounce@example.com")
    assert EmailSuppression.blocks_notifications?("BOUNCE@example.com")
  end

  test "a spam complaint suppresses every email" do
    deliver(event("spam"))
    row = EmailSuppression.find_by!(email: @user.email)
    assert_equal %w[all complaint], [row.scope, row.reason]
    assert EmailSuppression.blocks_all?(@user.email)
  end

  test "a provider block suppresses every email" do
    deliver(event("blocked"))
    row = EmailSuppression.find_by!(email: @user.email)
    assert_equal %w[all blocked], [row.scope, row.reason]
  end

  test "an unsubscribe stops notification emails but not sign-in emails" do
    deliver(event("unsubscribed"))
    row = EmailSuppression.find_by!(email: @user.email)
    assert_equal %w[notifications unsubscribed], [row.scope, row.reason]
    assert EmailSuppression.blocks_notifications?(@user.email)
    refute EmailSuppression.blocks_all?(@user.email)
  end

  test "a soft bounce is recorded but does not suppress" do
    deliver(event("soft_bounce", message_id: "<m1@brevo>"))
    deliver(event("soft_bounce", message_id: "<m2@brevo>"))
    row = EmailSuppression.find_by!(email: @user.email)
    assert_equal %w[none soft_bounce], [row.scope, row.reason]
    assert_equal 2, row.soft_bounce_count
    assert_nil row.suppressed_at
    refute EmailSuppression.blocks_notifications?(@user.email)
  end

  test "events that say nothing about deliverability are ignored" do
    deliver([event("delivered"), event("opened"), event("hard_bounce", email: "not-an-address")])
    assert_response :success
    assert_equal 3, response.parsed_body["ignored"]
    assert_equal 0, EmailSuppression.count
  end

  test "batched events are all recorded" do
    deliver([event("hard_bounce", email: "one@example.com"), event("spam", email: "two@example.com")])
    assert_equal 2, response.parsed_body["recorded"]
    assert_equal 2, EmailSuppression.suppressed.count
  end

  # --- idempotency and ordering -------------------------------------------------

  test "replaying the same event is a no-op" do
    payload = event("soft_bounce", message_id: "<same@brevo>")
    deliver(payload)
    deliver(payload)
    assert_equal 1, response.parsed_body["duplicate"]
    assert_equal 1, EmailSuppression.find_by!(email: @user.email).soft_bounce_count

    deliver(event("hard_bounce", message_id: "<hb@brevo>"))
    first = EmailSuppression.find_by!(email: @user.email).attributes
    deliver(event("hard_bounce", message_id: "<hb@brevo>"))
    assert_equal first.except("updated_at"), EmailSuppression.find_by!(email: @user.email).attributes.except("updated_at")
    assert_equal 1, EmailSuppression.count
  end

  test "a weaker event never lifts a stronger suppression" do
    deliver(event("hard_bounce", message_id: "<1>"))
    deliver(event("soft_bounce", message_id: "<2>"))
    deliver(event("unsubscribed", message_id: "<3>"))
    row = EmailSuppression.find_by!(email: @user.email)
    assert_equal %w[all hard_bounce unsubscribed], [row.scope, row.reason, row.last_event]
    assert EmailSuppression.blocks_all?(@user.email)

    deliver(event("unsubscribed", email: "later@example.com", message_id: "<4>"))
    deliver(event("spam", email: "later@example.com", message_id: "<5>"))
    assert_equal "all", EmailSuppression.find_by!(email: "later@example.com").scope, "a stronger event upgrades a weaker one"
  end

  # --- effect on sending ---------------------------------------------------------

  test "notification emails skip suppressed and unsubscribed addresses" do
    with_env(PROVIDER_ENV) do
      assert NotificationEmail.deliverable_to?(@user)
      EmailSuppression.record!(email: @user.email, event: "unsubscribed")
      refute NotificationEmail.deliverable_to?(@user)
      result = EmailDelivery.deliver_rendered(to: @user.email, template: "new_message", subject: "s", html: "h", text: "t")
      assert_equal "Recipient suppressed", result[:reason]
    end
  end

  test "transactional email to a hard-bounced address is not sent to the provider" do
    EmailSuppression.record!(email: @user.email, event: "hard_bounce")
    with_env(PROVIDER_ENV) do
      Faraday.stub(:post, ->(*) { flunk "the provider must not be called" }) do
        result = EmailDelivery.call(to: @user.email, template: "sign_in_code", data: { code: "123456" })
        assert_equal({ delivered: false, reason: "Recipient suppressed" }, result)
      end
    end
  end

  test "a sign-in code request for a hard-bounced address fails with a clear message" do
    EmailSuppression.record!(email: @user.email, event: "hard_bounce")
    with_env(PROVIDER_ENV) do
      assert_no_enqueued_jobs(only: EmailDeliveryJob) do
        post "/api/auth/otp/request", params: { email: "Bounce@example.com" }, as: :json
      end
    end
    assert_response :unprocessable_content
    assert_equal "EMAIL_SUPPRESSED", response.parsed_body["code"]
    assert_match(/bounced or was reported as spam/, response.parsed_body["error"])
    assert_equal 0, SignInCode.where(email: @user.email).count
  end

  test "an unsubscribed address still receives sign-in codes" do
    EmailSuppression.record!(email: @user.email, event: "unsubscribed")
    with_env(PROVIDER_ENV) do
      assert_enqueued_jobs(1, only: EmailDeliveryJob) do
        post "/api/auth/otp/request", params: { email: @user.email }, as: :json
      end
    end
    assert_response :success
  end

  # --- admin visibility --------------------------------------------------------------

  test "admin health counts suppressed addresses and the sign-in doctor explains them" do
    admin = User.create!(name: "Mail Admin", email: "mail-admin@example.com", password: "StrongPass123!", role: "admin", status: "active")
    raw = SecureRandom.urlsafe_base64(48)
    admin.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 1.day.from_now)
    headers = { "Authorization" => "Bearer #{raw}" }
    EmailSuppression.record!(email: @user.email, event: "hard_bounce")
    EmailSuppression.record!(email: "spam@example.com", event: "spam")
    EmailSuppression.record!(email: "unsub@example.com", event: "unsubscribed")
    EmailSuppression.record!(email: "soft@example.com", event: "soft_bounce")

    get "/api/admin/health", headers: headers
    summary = response.parsed_body["emailSuppressions"]
    assert_equal 3, summary["total"]
    assert_equal 2, summary["all"]
    assert_equal 1, summary["notificationsOnly"]
    assert_equal 1, summary["softBounces"]
    assert_equal({ "hard_bounce" => 1, "complaint" => 1, "unsubscribed" => 1 }, summary["byReason"])

    get "/api/admin/tester", headers: headers
    check = response.parsed_body["checks"].find { _1["name"] == "Email bounce webhook" }
    assert_match(/3 suppressed address/, check["detail"])

    get "/api/admin/users/lookup", params: { email: @user.email }, headers: headers
    assert_response :success
    assert_equal "all", response.parsed_body.dig("emailSuppression", "scope")
    assert_includes response.parsed_body["diagnosis"].pluck("code"), "EMAIL_SUPPRESSED"

    get "/api/admin/users/lookup", params: { email: "spam@example.com" }, headers: headers
    assert_includes response.parsed_body["diagnosis"].pluck("code"), "EMAIL_SUPPRESSED"
  end

  test "the migration can be rolled back and reapplied" do
    migration = CreateEmailSuppressions.new
    migration.verbose = false
    ActiveRecord::Base.transaction(requires_new: true) do
      migration.migrate(:down)
      refute ActiveRecord::Base.connection.table_exists?(:email_suppressions)
      migration.migrate(:up)
      assert ActiveRecord::Base.connection.table_exists?(:email_suppressions)
    end
  end

  private

  def event(type, email: @user.email, message_id: "<#{SecureRandom.hex(6)}@smtp-relay.mailin.fr>")
    { "event" => type, "email" => email, "id" => 12_345, "date" => "2026-09-27 10:00:00", "ts_event" => 1_790_000_000, "message-id" => message_id, "subject" => "Your Verse sign-in code" }
  end

  def json = { "Content-Type" => "application/json" }

  def deliver(payload)
    deliver_raw(payload.to_json)
  end

  def deliver_raw(body)
    with_env("BREVO_WEBHOOK_SECRET" => SECRET) do
      post "#{PATH}?token=#{SECRET}", params: body, headers: json
    end
  end

  def with_env(values)
    previous = values.keys.index_with { ENV[_1] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
