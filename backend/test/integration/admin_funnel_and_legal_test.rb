require "test_helper"

class AdminFunnelAndLegalTest < ActionDispatch::IntegrationTest
  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end

  test "the funnel tab is admin-only and defaults to a valid window" do
    employer = User.create!(name: "Funnel Employer", email: "funnel-emp-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "employer", status: "active")
    admin = User.create!(name: "Funnel Admin", email: "funnel-admin-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "admin", status: "active")

    get "/api/admin/funnel", headers: auth(employer)
    assert_response :forbidden

    get "/api/admin/funnel", headers: auth(admin)
    assert_response :success
    body = response.parsed_body
    assert_equal 7, body.fetch("windowDays")
    assert body.key?("funnel")
    assert body.key?("weekly")

    get "/api/admin/funnel", params: { days: 30 }, headers: auth(admin)
    assert_response :success
    assert_equal 30, response.parsed_body.fetch("windowDays")

    # An out-of-range window falls back to 7 rather than erroring.
    get "/api/admin/funnel", params: { days: 999 }, headers: auth(admin)
    assert_response :success
    assert_equal 7, response.parsed_body.fetch("windowDays")
  end

  test "the public legal policy endpoint exposes the booking policy and legal placeholders" do
    get "/api/legal/policy"
    assert_response :success
    body = response.parsed_body
    assert_equal false, body.dig("booking", "feeEnabled")
    assert body.dig("booking", "plainEnglish").is_a?(Array)
    assert body.dig("legal", "grievanceOfficer").is_a?(Hash)
    assert_equal false, body.dig("legal", "gstinPresent")
  end
end
