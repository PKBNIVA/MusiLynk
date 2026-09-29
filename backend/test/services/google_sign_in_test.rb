require "test_helper"

class GoogleSignInTest < ActiveSupport::TestCase
  PASSWORD = "StrongPass123!".freeze

  def claims(overrides = {})
    { "sub" => "google-uid-1", "email" => "musician@example.com", "email_verified" => true,
      "name" => "Musician Person", "picture" => "https://example.invalid/avatar.png" }.merge(overrides)
  end

  # --- Rule a: intent=signin -----------------------------------------------------------

  test "signin: existing connection signs that user in" do
    user = User.create!(name: "Existing", email: "existing@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    AuthConnection.create!(owner: user, provider: "google", provider_uid: "google-uid-1", email: user.email, email_verified: true)

    result = GoogleSignIn.call(claims: claims, intent: "signin")
    assert result.ok?
    assert_equal user, result.user
    assert_not result.created
  end

  test "signin: matching verified email links the connection to that account and notifies" do
    user = User.create!(name: "Matched", email: "musician@example.com", password: PASSWORD, role: "jobseeker", status: "active",
      email_verified: false)

    result = GoogleSignIn.call(claims: claims, intent: "signin")
    assert result.ok?
    assert_equal user, result.user
    assert_not result.created
    assert result.notify_linked
    assert user.reload.email_verified?
    assert AuthConnection.exists?(owner: user, provider: "google", provider_uid: "google-uid-1")
  end

  test "signin: no match creates a new user with the given role" do
    result = GoogleSignIn.call(claims: claims, intent: "signin", role: "employer", consent: true)
    assert result.ok?
    assert result.created
    assert_equal "employer", result.user.role
    assert result.user.email_verified?
    assert_not_nil result.user.consented_at
    assert_nil result.user.password_set_at
    assert AuthConnection.exists?(owner: result.user, provider: "google", provider_uid: "google-uid-1")
  end

  test "signin: no match and no role asks the caller to choose one" do
    result = GoogleSignIn.call(claims: claims, intent: "signin")
    assert_not result.ok?
    assert_equal "role_required", result.error
    assert_equal 0, User.count
  end

  test "signin: unverified Google email never links by email" do
    User.create!(name: "Matched", email: "musician@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    result = GoogleSignIn.call(claims: claims("email_verified" => false), intent: "signin", role: "jobseeker")
    assert_equal "email_unverified", result.error
    assert_equal 0, AuthConnection.count
  end

  # --- Rule c: intent=connect -----------------------------------------------------------

  test "connect: links regardless of email match" do
    owner = User.create!(name: "Owner", email: "owner@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    result = GoogleSignIn.call(claims: claims("email" => "totally-different@example.com"), intent: "connect", owner_user: owner)
    assert result.ok?
    assert_equal owner, result.user
    assert AuthConnection.exists?(owner: owner, provider: "google", provider_uid: "google-uid-1")
  end

  test "connect: a provider_uid already linked to someone else is refused" do
    other = User.create!(name: "Other", email: "other@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    AuthConnection.create!(owner: other, provider: "google", provider_uid: "google-uid-1", email: "other-google@example.com", email_verified: true)
    me = User.create!(name: "Me", email: "me@example.com", password: PASSWORD, role: "jobseeker", status: "active")

    result = GoogleSignIn.call(claims: claims, intent: "connect", owner_user: me)
    assert_equal "connected_elsewhere", result.error
  end

  test "connect: re-connecting the same account updates the existing connection" do
    owner = User.create!(name: "Owner", email: "owner@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    AuthConnection.create!(owner: owner, provider: "google", provider_uid: "google-uid-1", email: "old@example.com", email_verified: true)

    result = GoogleSignIn.call(claims: claims, intent: "connect", owner_user: owner)
    assert result.ok?
    assert_equal 1, AuthConnection.count
    assert_equal "musician@example.com", AuthConnection.last.email
  end
end
