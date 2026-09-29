require "test_helper"

# Reviews summary, response time and the fast-responder badge on the public talent card
# (ProfileStats), and the share_verification_publicly consent toggle on /api/profile.
class ProfileStatsAndConsentTest < ActionDispatch::IntegrationTest
  test "the public talent card includes the reviews summary, response time and fast-responder badge" do
    talent = create_user("Card Talent", "jobseeker")
    talent.update!(profile_complete: true)
    Badge.create!(user_id: talent.id, kind: "fast_responder_week", awarded_for: Badge.iso_week(Time.current))

    get "/api/public/talent/#{talent.id}"
    assert_response :success
    professional = response.parsed_body.fetch("professional")
    assert professional.key?("reviewsCount")
    assert professional.key?("reviewsAverage")
    assert professional.key?("responseTimeMinutes")
    assert_equal true, professional["fastResponderBadge"]
  end

  test "share_verification_publicly defaults true and can be turned off through profile settings" do
    talent = create_user("Consent Talent", "jobseeker")
    token = session_for(talent)

    get "/api/me", headers: auth(token)
    assert_equal true, response.parsed_body.dig("user", "shareVerificationPublicly")

    put "/api/profile", params: { shareVerificationPublicly: false }, headers: auth(token), as: :json
    assert_response :success
    assert_equal false, talent.profile.reload.share_verification_publicly
  end

  private

  def create_user(name, role)
    User.create!(name:, email: "profile-stats-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active", email_verified: true)
      .tap { _1.create_profile! }
  end

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    raw
  end

  def auth(token) = { "Authorization" => "Bearer #{token}" }
end
