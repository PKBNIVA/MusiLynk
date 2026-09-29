require "test_helper"

class VerificationChecksAndVouchingTest < ActionDispatch::IntegrationTest
  test "approving without at least one check is rejected" do
    admin = create_user("Checks Admin", "checks-admin@example.com", "admin")
    artist = create_user("Checks Artist", "checks-artist@example.com", "jobseeker")
    request_record = VerificationRequest.create!(user: artist, kind: "professional", evidence_url: "https://example.com/a", status: "pending")

    patch "/api/admin/verifications/#{request_record.id}", params: { status: "approved" }, headers: auth(session_for(admin)), as: :json
    assert_response :unprocessable_content
    assert_equal "CHECKS_REQUIRED", response.parsed_body.fetch("code")
    assert_equal "pending", request_record.reload.status
  end

  test "the public talent JSON exposes verification checks and verifiedAt" do
    admin = create_user("Public Admin", "public-admin@example.com", "admin")
    artist = create_user("Public Artist", "public-artist@example.com", "jobseeker")
    artist.update!(profile_complete: true)
    request_record = VerificationRequest.create!(user: artist, kind: "professional", evidence_url: "https://example.com/a", status: "pending")
    patch "/api/admin/verifications/#{request_record.id}", params: { status: "approved", checks: ["identity", "credits"] },
      headers: auth(session_for(admin)), as: :json
    assert_response :success

    get "/api/public/talent/#{artist.id}"
    assert_response :success
    verification = response.parsed_body.dig("professional", "verification")
    assert_equal ["identity", "credits"], verification.fetch("checks")
    assert verification.fetch("verifiedAt").present?
  end

  test "unverified users cannot vouch" do
    unverified = create_user("Unverified Musician", "unverified-musician@example.com", "jobseeker")
    post "/api/vouches", params: { email: "friend@example.com" }, headers: auth(session_for(unverified)), as: :json
    assert_response :forbidden
    assert_equal "NOT_VERIFIED", response.parsed_body.fetch("code")
  end

  test "a verified musician can create up to 3 active vouches and no more" do
    voucher = create_verified_musician("Voucher One", "voucher-one@example.com")
    token = session_for(voucher)
    3.times do |i|
      post "/api/vouches", params: { email: "vouchee#{i}@example.com" }, headers: auth(token), as: :json
      assert_response :created
    end
    post "/api/vouches", params: { email: "vouchee4@example.com" }, headers: auth(token), as: :json
    assert_response :unprocessable_content
    assert_equal 3, Vouch.where(voucher:).count
  end

  test "GET /api/vouches lists the user's vouches with status" do
    voucher = create_verified_musician("Voucher List", "voucher-list@example.com")
    token = session_for(voucher)
    post "/api/vouches", params: { email: "listed@example.com" }, headers: auth(token), as: :json
    assert_response :created

    get "/api/vouches", headers: auth(token)
    assert_response :success
    vouches = response.parsed_body.fetch("vouches")
    assert_equal 1, vouches.size
    assert_equal "invited", vouches.first.fetch("status")
  end

  test "signing up with a valid vouch token stamps vouched_by_id and flags/sorts the admin queue" do
    voucher = create_verified_musician("Voucher Signup", "voucher-signup@example.com")
    vouch = Vouch.create!(voucher:, vouchee_email: "invitee@example.com")

    post "/api/auth/register", params: { name: "Invitee", email: "invitee@example.com", password: "StrongPass123!", role: "jobseeker", vouch: vouch.token }, as: :json
    assert_response :created
    invitee = User.find_by!(email: "invitee@example.com")
    assert_equal voucher.id, invitee.vouched_by_id
    assert_equal "joined", vouch.reload.status

    # An older, non-vouched pending request should sort after the vouched applicant's.
    other = create_user("Other Applicant", "other-applicant@example.com", "jobseeker")
    older_request = VerificationRequest.create!(user: other, kind: "professional", evidence_url: "https://example.com/o", status: "pending", created_at: 1.day.ago)
    vouched_request = VerificationRequest.create!(user: invitee, kind: "professional", evidence_url: "https://example.com/i", status: "pending")

    admin = create_user("Queue Admin", "queue-admin@example.com", "admin")
    get "/api/admin/verifications", headers: auth(session_for(admin))
    assert_response :success
    rows = response.parsed_body.fetch("requests")
    ids = rows.map { _1["id"] }
    assert ids.index(vouched_request.id) < ids.index(older_request.id)
    assert_equal voucher.name, rows.find { _1["id"] == vouched_request.id }.fetch("vouchedByName")
  end

  private

  def create_user(name, email, role)
    User.create!(name:, email:, password: "StrongPass123!", role:, status: "active").tap(&:create_profile!)
  end

  def create_verified_musician(name, email)
    user = create_user(name, email, "jobseeker")
    user.profile.update!(verified: true)
    user
  end

  def auth(token) = { "Authorization" => "Bearer #{token}" }

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    raw
  end
end
