require "test_helper"

# Covers the "need someone by tomorrow" additions on top of the existing urgent_requests
# create/respond flow (see api_matrix_test.rb for the base CRUD contract): matching on
# create, the confirmation/status #show, and admin "mark filled by" attribution.
class UrgentRequestsMatchingTest < ActionDispatch::IntegrationTest
  setup do
    @hirer = create_user("Hirer", "urgent-hirer@example.com", "employer")
    @musician = create_user("Ready Musician", "urgent-musician@example.com", "jobseeker")
    @musician.create_profile!(headline: "Drummer", location: "Mumbai", roles: ["Drummer"], verified: true)
  end

  test "create matches and notifies, and returns the response-time promise" do
    post "/api/urgent-requests", params: { title: "Drummer needed", roleName: "Drummer", city: "Mumbai",
      startAt: 1.day.from_now.iso8601 }, headers: auth(@hirer), as: :json
    assert_response :created
    body = response.parsed_body
    assert_equal 1, body["notifiedCount"]
    assert_equal UrgentConfig.response_time_promise, body["responseTimePromise"]
    assert Notification.exists?(user: @musician, kind: "urgent_alert")
  end

  test "show returns the requester's own live status card, not someone else's" do
    item = UrgentRequest.create!(requester: @hirer, title: "Drummer needed", role_name: "Drummer", city: "Mumbai",
      start_at: 1.day.from_now, currency: "INR", status: "open")
    UrgentMatcher.notify!(item)

    get "/api/urgent-requests/#{item.id}", headers: auth(@hirer)
    assert_response :success
    body = response.parsed_body
    assert_equal 1, body.dig("request", "notified_count")
    assert_equal 0, body.dig("request", "responseCount")
    assert body["responseTimePromise"].present?

    other = create_user("Someone Else", "urgent-someone-else@example.com", "employer")
    get "/api/urgent-requests/#{item.id}", headers: auth(other)
    assert_response :not_found
  end

  test "marking filled records who filled it, but only someone who actually responded" do
    item = UrgentRequest.create!(requester: @hirer, title: "Drummer needed", role_name: "Drummer", city: "Mumbai",
      start_at: 1.day.from_now, currency: "INR", status: "open")

    outsider = create_user("Outsider", "urgent-outsider@example.com", "jobseeker")
    patch "/api/urgent-requests/#{item.id}", params: { status: "filled", filledByUserId: outsider.id }, headers: auth(@hirer), as: :json
    assert_response :unprocessable_content

    post "/api/urgent-requests/#{item.id}/respond", params: { message: "I'm free" }, headers: auth(@musician), as: :json
    assert_response :created

    patch "/api/urgent-requests/#{item.id}", params: { status: "filled", filledByUserId: @musician.id }, headers: auth(@hirer), as: :json
    assert_response :success
    assert_equal @musician.id, item.reload.filled_by_id
    assert_equal "filled", item.status
  end

  private

  def create_user(name, email, role)
    User.create!(name:, email:, password: "StrongPass123!", role:, status: "active", email_verified: true, profile_complete: true)
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
