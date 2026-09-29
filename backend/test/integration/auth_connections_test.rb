require "test_helper"

class AuthConnectionsTest < ActionDispatch::IntegrationTest
  PASSWORD = "StrongPass123!".freeze

  test "/auth/methods lists the signed-in user's connections" do
    user = User.create!(name: "Connected", email: "connected@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    AuthConnection.create!(owner: user, provider: "google", provider_uid: "uid-1", email: "connected@gmail.example", email_verified: true,
      display_name: "Connected Person")
    token = session_for(user)

    get "/api/auth/methods", headers: bearer(token)
    assert_response :success
    connections = response.parsed_body["connections"]
    assert_equal 1, connections.size
    assert_equal "google", connections.first["provider"]
    assert_equal "connected@gmail.example", connections.first["email"]
  end

  test "a user with a password can disconnect their only connection" do
    user = User.create!(name: "Has Password", email: "haspw@example.com", password: PASSWORD, role: "jobseeker", status: "active",
      password_set_at: Time.current)
    connection = AuthConnection.create!(owner: user, provider: "google", provider_uid: "uid-2", email_verified: true)
    token = session_for(user)

    delete "/api/auth/connections/#{connection.id}", headers: bearer(token)
    assert_response :success
    assert_not AuthConnection.exists?(connection.id)
  end

  test "a passwordless user may not disconnect their only sign-in method" do
    user = User.create!(name: "No Password", email: "nopw@example.com", password: SecureRandom.base58(32), role: "jobseeker",
      status: "active", password_set_at: nil)
    connection = AuthConnection.create!(owner: user, provider: "google", provider_uid: "uid-3", email_verified: true)
    token = session_for(user)

    delete "/api/auth/connections/#{connection.id}", headers: bearer(token)
    assert_response :unprocessable_content
    assert_equal "LAST_SIGN_IN_METHOD", response.parsed_body["code"]
    assert AuthConnection.exists?(connection.id)
  end

  test "a passwordless user with two connections may disconnect one" do
    user = User.create!(name: "Two Connections", email: "two@example.com", password: SecureRandom.base58(32), role: "jobseeker",
      status: "active", password_set_at: nil)
    first = AuthConnection.create!(owner: user, provider: "google", provider_uid: "uid-4", email_verified: true)
    AuthConnection.create!(owner: user, provider: "youtube", provider_uid: "uid-5", email_verified: true)
    token = session_for(user)

    delete "/api/auth/connections/#{first.id}", headers: bearer(token)
    assert_response :success
  end

  test "cannot disconnect another user's connection" do
    owner = User.create!(name: "Owner", email: "ownerx@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    connection = AuthConnection.create!(owner: owner, provider: "google", provider_uid: "uid-6", email_verified: true)
    other = User.create!(name: "Other", email: "otherx@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    token = session_for(other)

    delete "/api/auth/connections/#{connection.id}", headers: bearer(token)
    assert_response :not_found
    assert AuthConnection.exists?(connection.id)
  end

  test "account erasure removes auth connections" do
    user = User.create!(name: "To Erase", email: "erase-google@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    user.create_profile!
    AuthConnection.create!(owner: user, provider: "google", provider_uid: "uid-erase", email_verified: true)

    AccountErasure.new(user).call!
    assert_equal 0, AuthConnection.where(owner: user).count
  end

  private

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    Session.start!(user, token_digest: Digest::SHA256.hexdigest(raw), user_agent: nil)
    raw
  end

  def bearer(token) = { "Authorization" => "Bearer #{token}" }
end
