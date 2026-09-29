require "test_helper"

class PhoneOtpTest < ActionDispatch::IntegrationTest
  PASSWORD = "StrongPass123!".freeze
  WHATSAPP_ENV = { "WHATSAPP_ENABLED" => "true", "WHATSAPP_ACCESS_TOKEN" => "tok", "WHATSAPP_PHONE_NUMBER_ID" => "PNID",
    "WHATSAPP_TEMPLATE_OTP" => "otp_template" }.freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  test "dark by default: request is refused and /auth/methods reports whatsapp: false" do
    with_env(WHATSAPP_ENABLED: nil) do
      post "/api/auth/phone-otp/request", params: { phone: "+919812345678" }, as: :json
      assert_response :service_unavailable
      get "/api/auth/methods"
      assert_equal false, response.parsed_body.dig("providers", "whatsapp")
    end
  end

  test "enabled: /auth/methods reports whatsapp: true" do
    with_env(WHATSAPP_ENV) do
      get "/api/auth/methods"
      assert_equal true, response.parsed_body.dig("providers", "whatsapp")
    end
  end

  test "a signed-in user can verify and attach a phone" do
    user = User.create!(name: "Signed In", email: "signedin@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    token = session_for(user)

    stub_whatsapp do
      with_env(WHATSAPP_ENV) do
        post "/api/auth/phone-otp/request", params: { phone: "9812345678" }, headers: bearer(token), as: :json
        assert_response :success
        raw = @sent_codes.last
        post "/api/auth/phone-otp/verify", params: { phone: "9812345678", code: raw }, headers: bearer(token), as: :json
      end
    end
    assert_response :success
    assert_equal "+919812345678", user.reload.phone
    assert user.phone_verified_at.present?
  end

  test "an unverified stored phone is never a sign-in method" do
    other = User.create!(name: "Other", email: "otherphone@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    other.update_columns(phone: "+919000000000", phone_verified_at: nil)

    with_env(WHATSAPP_ENV) do
      post "/api/auth/phone-otp/request", params: { phone: "+919000000000" }, as: :json
      assert_response :success
      raw = response.parsed_body["debugCode"]
      post "/api/auth/phone-otp/verify", params: { phone: "+919000000000", code: raw }, as: :json
      assert_response :unauthorized
    end
  end

  test "signing in with a verified phone code" do
    user = User.create!(name: "Phone User", email: "phoneuser@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    user.update_columns(phone: "+919812345000", phone_verified_at: 1.day.ago)

    stub_whatsapp do
      with_env(WHATSAPP_ENV) do
        post "/api/auth/phone-otp/request", params: { phone: "+919812345000" }, as: :json
        raw = @sent_codes.last
        post "/api/auth/phone-otp/verify", params: { phone: "+919812345000", code: raw }, as: :json
      end
    end
    assert_response :success
    assert response.parsed_body["accessToken"].present?
    assert_equal user.id, response.parsed_body.dig("user", "id")
  end

  test "invalid code is refused and rate limited like the email path" do
    with_env(WHATSAPP_ENV) do
      (AuthController::OTP_VERIFY_FAILURES_PER_IP + 1).times do
        post "/api/auth/phone-otp/verify", params: { phone: "+919812345678", code: "000000" }, as: :json
      end
      assert_response :too_many_requests
    end
  end

  private

  def stub_whatsapp
    @sent_codes = []
    sent_codes = @sent_codes
    WhatsappOtp.define_singleton_method(:send_code) { |phone:, code:, client: nil| sent_codes << code; true }
    yield
  end

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    Session.start!(user, token_digest: Digest::SHA256.hexdigest(raw), user_agent: nil)
    raw
  end

  def bearer(token) = { "Authorization" => "Bearer #{token}" }

  def with_env(values)
    old = values.to_h { |key, _| [key.to_s, ENV[key.to_s]] }
    values.each { |key, value| value.nil? ? ENV.delete(key.to_s) : ENV[key.to_s] = value }
    yield
  ensure
    old&.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
