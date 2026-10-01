require "test_helper"

class EmailPreferencesTest < ActionDispatch::IntegrationTest
  test "PUT /api/me/email-preferences updates only the categories given, leaving others and the master switch alone" do
    user = create_user
    user.profile.update!(email_preferences: { "digest" => true, "lifecycle" => true, "requests" => true, "product" => true })

    put "/api/me/email-preferences", params: { emailPreferences: { digest: false } }, headers: auth(user), as: :json
    assert_response :success
    prefs = response.parsed_body.fetch("emailPreferences")
    assert_equal({ "digest" => false, "lifecycle" => true, "requests" => true, "product" => true }, prefs)
    assert user.profile.reload.email_notifications?
  end

  test "PUT /api/me/email-preferences rejects an unknown category or a non-boolean value" do
    user = create_user
    put "/api/me/email-preferences", params: { emailPreferences: { spam: false } }, headers: auth(user), as: :json
    assert_response :bad_request

    put "/api/me/email-preferences", params: { emailPreferences: { digest: "off" } }, headers: auth(user), as: :json
    assert_response :bad_request
  end

  test "paymentsNotify defaults to off, is saved by the preferences endpoint and is readable by the owner" do
    user = create_user
    get "/api/notifications/preferences", headers: auth(user)
    assert_equal false, response.parsed_body["paymentsNotify"]

    put "/api/me/email-preferences", params: { emailPreferences: { paymentsNotify: true } }, headers: auth(user), as: :json
    assert_response :success
    assert_equal true, response.parsed_body["paymentsNotify"]
    assert user.profile.reload.payments_notify?
    assert_equal 1, Profile.where("email_preferences ->> 'paymentsNotify' = 'true'").count
    assert user.profile.email_category_enabled?("digest"), "it is not a category and never narrows other emails"

    get "/api/notifications/preferences", headers: auth(user)
    assert_equal true, response.parsed_body["paymentsNotify"]

    put "/api/me/email-preferences", params: { emailPreferences: { paymentsNotify: "yes" } }, headers: auth(user), as: :json
    assert_response :bad_request
    put "/api/me/email-preferences", params: { emailPreferences: { paymentsNotify: false } }, headers: auth(user), as: :json
    assert_equal false, response.parsed_body["paymentsNotify"]
  end

  test "PUT /api/me/email-preferences requires sign-in" do
    put "/api/me/email-preferences", params: { emailPreferences: { digest: false } }, as: :json
    assert_response :unauthorized
  end

  test "the unsubscribe manage-emails page reads and writes preferences by token, without signing in" do
    user = create_user
    token = NotificationEmail.unsubscribe_token(user)

    get "/api/notifications/unsubscribe/preferences", params: { token: }
    assert_response :success
    body = response.parsed_body
    assert_equal true, body["emailNotifications"]
    assert_equal({ "digest" => true, "lifecycle" => true, "requests" => true, "product" => true }, body["emailPreferences"])

    patch "/api/notifications/unsubscribe/preferences", params: { token:, emailPreferences: { requests: false } }, as: :json
    assert_response :success
    assert_equal false, response.parsed_body.dig("emailPreferences", "requests")
    assert_equal false, user.profile.reload.email_preferences["requests"]

    patch "/api/notifications/unsubscribe/preferences", params: { token:, emailNotifications: false }, as: :json
    assert_response :success
    assert_not user.profile.reload.email_notifications?
  end

  test "the unsubscribe manage-emails page rejects an invalid token" do
    get "/api/notifications/unsubscribe/preferences", params: { token: "not-a-real-token" }
    assert_response :bad_request

    patch "/api/notifications/unsubscribe/preferences", params: { token: "not-a-real-token", emailNotifications: false }, as: :json
    assert_response :bad_request
  end

  test "email_category_enabled? on Profile respects both the master switch and the category" do
    user = create_user
    profile = user.profile
    assert profile.email_category_enabled?("digest")

    profile.update!(email_preferences: profile.email_preferences.merge("digest" => false))
    assert_not profile.email_category_enabled?("digest")
    assert profile.email_category_enabled?("lifecycle")

    profile.update!(email_notifications: false)
    assert_not profile.email_category_enabled?("lifecycle") # master switch wins
  end

  private

  def create_user
    User.create!(name: "Prefs User", email: "prefs-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!",
      role: "jobseeker", status: "active", email_verified: true).tap { _1.create_profile! }
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
