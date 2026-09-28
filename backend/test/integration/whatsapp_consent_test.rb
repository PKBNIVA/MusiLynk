require "test_helper"

class WhatsappConsentTest < ActionDispatch::IntegrationTest
  setup do
    @musician = User.create!(name: "Consent Musician", email: "wa-consent@example.com", password: "StrongPass123!",
      role: "jobseeker", status: "active", email_verified: true)
  end

  test "ticking consent with a valid number saves both" do
    post "/api/profile/whatsapp-consent", params: { phoneE164: "+919812345678", consent: true }, headers: auth(@musician), as: :json
    assert_response :success
    profile = @musician.reload.profile
    assert_equal "+919812345678", profile.phone_e164
    assert profile.whatsapp_consented_at.present?
    assert AuditLog.exists?(actor: @musician, action: "profile.whatsapp_consent")
  end

  test "rejects a non-E.164 number when consenting" do
    post "/api/profile/whatsapp-consent", params: { phoneE164: "9812345678", consent: true }, headers: auth(@musician), as: :json
    assert_response :unprocessable_content
    assert_equal "INVALID_PHONE", response.parsed_body["code"]
  end

  test "unticking consent clears the consent timestamp even if a number remains" do
    post "/api/profile/whatsapp-consent", params: { phoneE164: "+919812345678", consent: true }, headers: auth(@musician), as: :json
    assert_response :success

    post "/api/profile/whatsapp-consent", params: { phoneE164: "+919812345678", consent: false }, headers: auth(@musician), as: :json
    assert_response :success
    assert_nil @musician.reload.profile.whatsapp_consented_at
  end

  test "an unverified/unconsented profile is never a WhatsappAlerts-eligible candidate" do
    assert_not WhatsappAlerts.eligible?(@musician)
  end

  private

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
