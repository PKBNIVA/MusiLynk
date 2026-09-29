require "test_helper"

class ShareCardsControllerTest < ActionDispatch::IntegrationTest
  def make_user(verified:, consented:)
    user = User.create!(name: "Verified Musician", email: "verified-musician-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "jobseeker", status: "active")
    user.create_profile!(verified:, share_verification_publicly: consented)
    user
  end

  test "serves the story card, cached for 24h, only for a verified and consenting musician" do
    user = make_user(verified: true, consented: true)

    get "/share-cards/verified/#{user.id}.svg"

    assert_response :success
    assert_equal "image/svg+xml", @response.media_type
    assert_includes @response.headers["Cache-Control"], "max-age=86400"
    assert_includes @response.body, "<svg"
  end

  test "serves the landscape variant too" do
    user = make_user(verified: true, consented: true)
    get "/share-cards/verified/#{user.id}/landscape.svg"
    assert_response :success
    assert_includes @response.body, "1200"
  end

  test "404s for an unverified musician" do
    user = make_user(verified: false, consented: true)
    get "/share-cards/verified/#{user.id}.svg"
    assert_response :not_found
  end

  test "404s when the musician has not consented to sharing their verification" do
    user = make_user(verified: true, consented: false)
    get "/share-cards/verified/#{user.id}.svg"
    assert_response :not_found
  end

  test "404s for a non-existent user" do
    get "/share-cards/verified/none_00000000-0000-4000-8000-000000000000.svg"
    assert_response :not_found
  end
end
