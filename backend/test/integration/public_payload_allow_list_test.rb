require "test_helper"

# T-01: the public talent payloads are an explicit allow-list. The users table carries consent,
# phone-verification, vouching and password timestamps (and a search-only counter column) that
# must never reach an anonymous visitor.
class PublicPayloadAllowListTest < ActionDispatch::IntegrationTest
  LEAKED_KEYS = %w[password_set_at consented_at phone_verified_at vouched_by_id email_verified profile_complete search_total].freeze

  setup do
    @voucher = create_user("Voucher Person", "voucher-allow@example.com")
    @musician = create_user("Allow List Drummer", "allow-list-drummer@example.com")
    @musician.update!(consented_at: Time.current, phone_verified_at: Time.current, password_set_at: Time.current, vouched_by_id: @voucher.id, email_verified: true)
    @musician.profile.update!(headline: "Session drummer", location: "Mumbai", roles: ["Drummer"], session_rate: 5000, verified: true)
    @viewer = create_user("Allow List Hirer", "allow-list-hirer@example.com", role: "employer")
    @headers = { "Authorization" => "Bearer #{session_for(@viewer)}" }
  end

  test "the seven leaked keys are absent from every public talent endpoint" do
    get "/api/public/talent", params: { q: "drummer" }
    assert_response :success
    assert_operator response.parsed_body["talent"].length, :>=, 1
    assert_clean response.parsed_body["talent"], "/api/public/talent"

    get "/api/public/talent/#{@musician.id}"
    assert_response :success
    assert_clean response.parsed_body["professional"], "/api/public/talent/:id"

    get "/api/candidates", headers: @headers, params: { q: "drummer" }
    assert_response :success
    assert_operator response.parsed_body["candidates"].length, :>=, 1
    assert_clean response.parsed_body["candidates"], "/api/candidates"

    get "/api/candidates/#{@musician.id}", headers: @headers
    assert_response :success
    assert_clean response.parsed_body["candidate"], "/api/candidates/:id"

    get "/api/search", params: { q: "drummer", type: "talent" }
    assert_response :success
    assert_operator response.parsed_body["results"].length, :>=, 1
    assert_clean response.parsed_body, "/api/search"
  end

  test "the public payload keeps what the cards and profile pages render" do
    get "/api/public/talent/#{@musician.id}"
    person = response.parsed_body["professional"]
    assert_equal @musician.id, person["id"]
    assert_equal "Allow List Drummer", person["name"]
    assert_equal "Session drummer", person["headline"]
    assert_equal ["Drummer"], person["roles"]
    assert_equal 5000, person["sessionRate"]
    assert_equal true, person["verified"]
    assert_includes person.keys, "createdAt"
    assert_includes person.keys, "reviewsCount"
    assert_includes person.keys, "demo"
    %w[email phone phoneE164 status emailNotifications emailPreferences whatsappConsentedAt synthetic_batch last_login_at].each do |key|
      assert_not_includes person.keys, key
    end
  end

  test "the public payload carries the profile photo and event types (B1)" do
    photo = "https://media.example.org/uploads/photo.webp"
    @musician.profile.update!(photo_url: photo, event_types: ["Wedding", "Corporate"])
    get "/api/public/talent/#{@musician.id}"
    person = response.parsed_body["professional"]
    assert_equal photo, person["photoUrl"]
    assert_equal ["Wedding", "Corporate"], person["eventTypes"]
    get "/api/public/talent", params: { q: "drummer" }
    assert_equal photo, response.parsed_body["talent"].first["photoUrl"]
  end

  test "a hidden synthetic batch is not reachable by direct URL, a demo profile is" do
    hidden = create_user("Hidden QA Person", "hidden-qa-allow@example.com", batch: "local-qa")
    demo = create_user("Demo Batch Person", "demo-batch-allow@example.com", batch: "demo-20260926-1200")

    get "/api/public/talent/#{hidden.id}"
    assert_response :not_found
    get "/api/candidates/#{hidden.id}", headers: @headers
    assert_response :not_found
    get "/api/public/talent/#{demo.id}"
    assert_response :success
    assert_equal true, response.parsed_body.dig("professional", "demo")
    get "/api/candidates/#{demo.id}", headers: @headers
    assert_response :success
  end

  private

  def assert_clean(payload, label)
    keys = collect_keys(payload)
    assert_empty keys & LEAKED_KEYS, "#{label} leaks #{(keys & LEAKED_KEYS).join(', ')}"
  end

  def collect_keys(node)
    case node
    when Hash then node.keys + node.values.flat_map { collect_keys(_1) }
    when Array then node.flat_map { collect_keys(_1) }
    else []
    end
  end

  def create_user(name, email, role: "jobseeker", batch: nil)
    User.create!(name:, email:, password: "StrongPass123!", role:, status: "active", profile_complete: true, synthetic_batch: batch).tap { _1.create_profile! }
  end

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    raw
  end
end
