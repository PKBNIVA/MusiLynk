require "test_helper"

class AdminUrgentRequestsTest < ActionDispatch::IntegrationTest
  setup do
    @admin = create_user("Urgent Admin", "urgent-admin@example.com", "admin")
    @hirer = create_user("Urgent Hirer", "urgent-admin-hirer@example.com", "employer")
    @musician = create_user("Urgent Musician", "urgent-admin-musician@example.com", "jobseeker")
    @musician.create_profile!(headline: "Drummer", location: "Mumbai", roles: ["Drummer"], verified: true)
    @urgent = UrgentRequest.create!(requester: @hirer, title: "Drummer needed", role_name: "Drummer",
      city: "Mumbai", start_at: 1.day.from_now, currency: "INR", status: "open")
  end

  test "non-admin cannot reach any admin urgent-requests route" do
    get "/api/admin/urgent-requests", headers: auth(@hirer)
    assert_response :forbidden
  end

  test "index lists open requests with age, response count and the no-response flag, plus today's funnel" do
    # Pin the clock to midday so "90 minutes ago" is still today, whatever hour CI runs at.
    travel_to Time.current.change(hour: 12)
    @urgent.update!(created_at: 90.minutes.ago)

    get "/api/admin/urgent-requests", headers: auth(@admin)
    assert_response :success
    body = response.parsed_body
    row = body["requests"].find { _1["id"] == @urgent.id }
    assert row["ageMinutes"] >= 90
    assert row["noResponseAfterWindow"]
    assert_equal 0, row["responseCount"]
    assert_equal 1, body.dig("funnel", "requestsToday")
  end

  test "candidates returns the ranked list with verification, city and already-notified state" do
    get "/api/admin/urgent-requests/#{@urgent.id}/candidates", headers: auth(@admin)
    assert_response :success
    candidate = response.parsed_body["candidates"].find { _1["userId"] == @musician.id }
    assert candidate
    assert_equal true, candidate["verified"]
    assert_equal "Mumbai", candidate["city"]
    assert_equal false, candidate["alreadyNotified"]
  end

  test "notify sends the alert to one candidate, is audited, and is idempotent" do
    post "/api/admin/urgent-requests/#{@urgent.id}/notify", params: { candidateUserId: @musician.id }, headers: auth(@admin), as: :json
    assert_response :success
    assert_equal true, response.parsed_body["sent"]
    assert Notification.exists?(user: @musician, kind: "urgent_alert")
    assert AuditLog.exists?(actor: @admin, action: "admin.urgent_request.notify", entity_id: @urgent.id)

    post "/api/admin/urgent-requests/#{@urgent.id}/notify", params: { candidateUserId: @musician.id }, headers: auth(@admin), as: :json
    assert_response :success
    assert_equal false, response.parsed_body["sent"]
    assert_equal 1, Notification.where(user: @musician, kind: "urgent_alert").count
  end

  test "mark filled records who filled it and audits the action; mark expired too" do
    post "/api/urgent-requests/#{@urgent.id}/respond", params: { message: "Free tonight" }, headers: auth(@musician), as: :json
    assert_response :created

    patch "/api/admin/urgent-requests/#{@urgent.id}", params: { status: "filled", filledByUserId: @musician.id }, headers: auth(@admin), as: :json
    assert_response :success
    assert_equal "filled", @urgent.reload.status
    assert_equal @musician.id, @urgent.filled_by_id
    assert AuditLog.exists?(actor: @admin, action: "admin.urgent_request.update", entity_id: @urgent.id)

    other = UrgentRequest.create!(requester: @hirer, title: "Bassist needed", role_name: "Bassist", city: "Mumbai",
      start_at: 1.day.from_now, currency: "INR", status: "open")
    patch "/api/admin/urgent-requests/#{other.id}", params: { status: "expired" }, headers: auth(@admin), as: :json
    assert_response :success
    assert_equal "expired", other.reload.status
  end

  test "founder notes can be saved on their own, without changing status" do
    patch "/api/admin/urgent-requests/#{@urgent.id}", params: { founderNotes: "Called the hirer, they still need cover." },
      headers: auth(@admin), as: :json
    assert_response :success
    assert_equal "open", @urgent.reload.status
    assert_equal "Called the hirer, they still need cover.", @urgent.founder_notes
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
