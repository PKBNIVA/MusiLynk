require "test_helper"

# Covers the "need someone by tomorrow" additions on top of the existing urgent_requests
# create/respond flow (see api_matrix_test.rb for the base CRUD contract): matching on
# create, the confirmation/status #show, and admin "mark filled by" attribution.
class UrgentRequestsMatchingTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    @hirer = create_user("Hirer", "urgent-hirer@example.com", "employer")
    @musician = create_user("Ready Musician", "urgent-musician@example.com", "jobseeker")
    @musician.create_profile!(headline: "Drummer", location: "Mumbai", roles: ["Drummer"], verified: true)
  end

  test "create returns at once with matching pending, and the job then matches and notifies" do
    post_urgent
    assert_response :created
    body = response.parsed_body
    assert_equal 0, body["notifiedCount"]
    assert_equal "pending", body["matchStatus"]
    assert_equal UrgentConfig.response_time_promise, body["responseTimePromise"]
    assert_not Notification.exists?(user: @musician, kind: "urgent_alert"), "no alert is sent inside the request"

    perform_enqueued_jobs(only: UrgentMatchJob)
    assert Notification.exists?(user: @musician, kind: "urgent_alert")
    get "/api/urgent-requests/#{body['id']}", headers: auth(@hirer)
    assert_equal 1, response.parsed_body.dig("request", "notified_count")
    assert_equal "done", response.parsed_body.dig("request", "match_status")
  end

  test "create enqueues exactly one UrgentMatchJob and does no matching or notifying queries itself" do
    sql = []
    counter = ->(*, payload) { sql << payload[:sql] unless payload[:name] == "SCHEMA" || payload[:cached] }
    assert_enqueued_jobs 1, only: UrgentMatchJob do
      ActiveSupport::Notifications.subscribed(counter, "sql.active_record") { post_urgent }
    end
    assert_response :created
    assert_enqueued_with(job: UrgentMatchJob, args: [response.parsed_body["id"]])
    assert_no_enqueued_jobs(only: [NotificationEmailJob, PushDeliveryJob, WhatsappAlertJob])
    assert_empty sql.grep(/urgent_request_notifications|MAX\("sessions"|availability_windows|FROM "notifications"/i),
      "matching and notification queries must not run in the request"
    assert_operator sql.size, :<=, 12, "POST should only validate, insert and enqueue (#{sql.size} queries)"
    assert_empty Notification.where(kind: "urgent_alert")
  end

  test "match_status is not shown to musicians browsing the request" do
    post_urgent
    get "/api/urgent-requests", params: { scope: "browse" }, headers: auth(@musician)
    row = response.parsed_body["requests"].first
    assert_not row.key?("match_status")
    assert_not row.key?("notified_count")
  end

  test "create needs role, when, city, a budget band and a note, and reports every gap at once" do
    post "/api/urgent-requests", params: { roleName: "Drummer" }, headers: auth(@hirer), as: :json
    assert_response :unprocessable_content
    assert_equal %w[budget city note startAt], response.parsed_body.fetch("fields").keys.sort

    post "/api/urgent-requests", params: { roleName: "Drummer", city: "Mumbai", startAt: 1.day.ago.iso8601, budgetMax: 5_000, note: "Tonight" }, headers: auth(@hirer), as: :json
    assert_response :unprocessable_content
    assert_equal ["startAt"], response.parsed_body.fetch("fields").keys
    assert_equal 0, UrgentRequest.count
  end

  test "create writes the title from the role and city, and folds the optional details into the requirements" do
    post "/api/urgent-requests", params: { roleName: "Drummer", city: "Mumbai", startAt: 1.day.from_now.iso8601, budgetMin: 25_000,
      note: "Two sets.", venue: "Blue Frog", requirements: "Own kit", instrument: "Drums" }, headers: auth(@hirer), as: :json
    assert_response :created
    item = UrgentRequest.find(response.parsed_body.fetch("id"))
    assert_equal "Drummer needed in Mumbai", item.title
    assert_equal "Two sets.\nVenue: Blue Frog\nRequirements: Own kit", item.requirements
    assert_equal "Drums", item.instrument
    assert_nil item.budget_max
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

  test "create sets an expires_at from urgent.yml's expire_after_hours" do
    post "/api/urgent-requests", params: { title: "Drummer needed", roleName: "Drummer", city: "Mumbai",
      startAt: 1.day.from_now.iso8601, budgetMin: 5_000, budgetMax: 10_000, note: "Two sets, gear provided." }, headers: auth(@hirer), as: :json
    assert_response :created
    item = UrgentRequest.find(response.parsed_body.fetch("id"))
    assert_in_delta (item.created_at + UrgentConfig.expire_after).to_i, item.expires_at.to_i, 2
  end

  test "the hirer can close their request with the new closed status" do
    item = UrgentRequest.create!(requester: @hirer, title: "Drummer needed", role_name: "Drummer", city: "Mumbai",
      start_at: 1.day.from_now, currency: "INR", status: "open")

    patch "/api/urgent-requests/#{item.id}", params: { status: "closed" }, headers: auth(@hirer), as: :json
    assert_response :success
    assert_equal "closed", item.reload.status
  end

  test "the one-click token link marks a request filled without a session" do
    item = UrgentRequest.create!(requester: @hirer, title: "Drummer needed", role_name: "Drummer", city: "Mumbai",
      start_at: 1.day.from_now, currency: "INR", status: "open")
    token = UrgentActionToken.generate(item, "filled")

    get "/api/urgent-requests/#{item.id}/token-action", params: { action: "filled", t: token }
    assert_response :success
    assert_equal "filled", item.reload.status
  end

  test "the one-click token link rejects a tampered or unknown token" do
    item = UrgentRequest.create!(requester: @hirer, title: "Drummer needed", role_name: "Drummer", city: "Mumbai",
      start_at: 1.day.from_now, currency: "INR", status: "open")

    get "/api/urgent-requests/#{item.id}/token-action", params: { action: "close", t: "not-a-real-token" }
    assert_response :unprocessable_content
    assert_equal "open", item.reload.status
  end

  test "the one-click token link cannot be reused across a different request" do
    item = UrgentRequest.create!(requester: @hirer, title: "Drummer needed", role_name: "Drummer", city: "Mumbai",
      start_at: 1.day.from_now, currency: "INR", status: "open")
    other_item = UrgentRequest.create!(requester: @hirer, title: "Bassist needed", role_name: "Bassist", city: "Mumbai",
      start_at: 1.day.from_now, currency: "INR", status: "open")
    token = UrgentActionToken.generate(item, "close")

    get "/api/urgent-requests/#{other_item.id}/token-action", params: { action: "close", t: token }
    assert_response :unprocessable_content
    assert_equal "open", other_item.reload.status
  end

  private

  def post_urgent
    post "/api/urgent-requests", params: { title: "Drummer needed", roleName: "Drummer", city: "Mumbai",
      startAt: 1.day.from_now.iso8601, budgetMin: 5_000, budgetMax: 10_000, note: "Two sets, gear provided." }, headers: auth(@hirer), as: :json
  end

  def create_user(name, email, role)
    User.create!(name:, email:, password: "StrongPass123!", role:, status: "active", email_verified: true, profile_complete: true)
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
