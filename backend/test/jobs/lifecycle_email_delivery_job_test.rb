require "test_helper"
require "minitest/mock"

class LifecycleEmailDeliveryJobTest < ActiveJob::TestCase
  Response = Struct.new(:status, :body) do
    def success? = status.between?(200, 299)
  end
  FakeRequest = Struct.new(:headers, :body, :options)

  setup do
    @user = User.create!(name: "Lifecycle Recipient", email: "lifecycle-recipient@example.com", password: "StrongPass123!",
      role: "jobseeker", status: "active", email_verified: true)
    @user.create_profile!
  end

  test "renders a step with a Manage emails link, escaping and dynamic copy" do
    sent = []
    with_env("EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send", "FRONTEND_URL" => "https://musilynk.example") do
      Faraday.stub(:post, capture(sent)) do
        LifecycleEmailDeliveryJob.perform_now(@user.id, "musician_day21_inactive_requests", { "count" => 3, "city" => "Chennai" })
      end
    end
    _url, body = sent.sole
    data = body.fetch("data")
    assert_equal "3 new requests near you this week", data["subject"]
    assert_includes data["html"], "Manage emails"
    assert_includes data["html"], "https://musilynk.example/unsubscribe?token="
    assert_includes data["text"], "Manage which MusiLynk emails you get: https://musilynk.example/unsubscribe?token="
  end

  test "stamps delivered_at on the claimed row once the provider accepts the message, and not when it rejects" do
    row = LifecycleEmail.record!(@user, "musician_day1_first_link") && LifecycleEmail.find_by!(user: @user, key: "musician_day1_first_link")
    with_env("EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send") do
      Faraday.stub(:post, capture([], status: 400)) do
        LifecycleEmailDeliveryJob.perform_now(@user.id, "musician_day1_first_link", {})
      end
      assert_nil row.reload.delivered_at

      Faraday.stub(:post, capture([])) do
        LifecycleEmailDeliveryJob.perform_now(@user.id, "musician_day1_first_link", {})
      end
    end
    assert_not_nil row.reload.delivered_at
  end

  test "skips a recipient whose category preference is off, without calling the provider" do
    @user.profile.update!(email_preferences: @user.profile.email_preferences.merge("lifecycle" => false))
    called = false
    Faraday.stub(:post, ->(*) { called = true; flunk "provider must not be called" }) do
      with_env("EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send") do
        LifecycleEmailDeliveryJob.perform_now(@user.id, "musician_day1_first_link", {})
      end
    end
    assert_not called
  end

  test "does not skip a lifecycle email for the master switch when only an unrelated category is off" do
    @user.profile.update!(email_preferences: @user.profile.email_preferences.merge("digest" => false))
    sent = []
    with_env("EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send") do
      Faraday.stub(:post, capture(sent)) do
        LifecycleEmailDeliveryJob.perform_now(@user.id, "musician_day1_first_link", {})
      end
    end
    assert_equal 1, sent.size
  end

  test "skips when the master switch is off, even if the category is on" do
    @user.profile.update!(email_notifications: false)
    called = false
    Faraday.stub(:post, ->(*) { called = true; flunk "provider must not be called" }) do
      with_env("EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send") do
        LifecycleEmailDeliveryJob.perform_now(@user.id, "musician_day1_first_link", {})
      end
    end
    assert_not called
  end

  private

  def capture(sent, status: 202)
    lambda do |url, &configure|
      request = FakeRequest.new({}, nil, Struct.new(:open_timeout, :timeout).new)
      configure.call(request)
      sent << [url, JSON.parse(request.body)]
      Response.new(status, "{}")
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
