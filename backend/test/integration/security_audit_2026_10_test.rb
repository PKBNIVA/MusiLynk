require "test_helper"
require "openssl"

# Reproductions for the October 2026 security and privacy audit (docs/security/AUDIT-2026-10.md).
# Each test is named after its finding id and fails on the code as audited; the fix turns it green.
class SecurityAudit202610Test < ActionDispatch::IntegrationTest
  PASSWORD = "StrongPass123!".freeze

  setup do
    @seq = 0
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @alice = create_user("Alice Audit", "jobseeker", location: "Mumbai", roles: ["Drummer"])
    @bob = create_user("Bob Audit", "jobseeker", location: "Mumbai", roles: ["Drummer"])
    @hirer = create_user("Hirer Audit", "employer", company_name: "Audit Studio")
  end

  teardown { Rails.cache = @original_cache }

  # ---- URG-1: internal admin notes leak through the urgent request payloads -------------------

  test "URG-1 other users and the requester never see founder_notes or other internal columns" do
    request = UrgentRequest.create!(requester: @hirer, title: "Drummer needed", role_name: "Drummer", city: "Mumbai",
      start_at: 2.days.from_now, currency: "INR", status: "open", budget_min: 1000, budget_max: 2000,
      requirements: "Bring sticks", founder_notes: "INTERNAL: requester looks dodgy", notified_count: 7)

    get "/api/urgent-requests?scope=browse", headers: auth(@alice)
    assert_response :success
    listed = response.parsed_body["requests"].find { _1["id"] == request.id }
    assert listed, "the open request is browsable"
    assert_internal_columns_absent(listed, delivery: true)

    # The requester keeps the delivery counts the status screen shows (notified_count), never the founders' notes.
    get "/api/urgent-requests?scope=mine", headers: auth(@hirer)
    assert_response :success
    own = response.parsed_body["requests"].find { _1["id"] == request.id }
    assert_internal_columns_absent(own)
    assert_equal 7, own["notified_count"]

    get "/api/urgent-requests/#{request.id}", headers: auth(@hirer)
    assert_response :success
    assert_internal_columns_absent(response.parsed_body["request"])
  end

  # ---- URG-2: unlimited urgent requests fan out unlimited notifications ---------------------

  test "URG-2 posting urgent requests is rate limited per account" do
    statuses = Array.new(12) do
      post "/api/urgent-requests", params: { roleName: "Drummer", city: "Mumbai", startAt: 2.days.from_now.iso8601, budgetMin: 1000,
        budgetMax: 2000, note: "Wedding gig, 3 hours" }, headers: auth(@hirer), as: :json
      response.status
    end
    assert_includes statuses, 429, "an account can post an unbounded number of urgent requests per hour"
    assert_operator statuses.count(201), :<=, 10
  end

  # ---- STG-1/2/3: Stage visibility rules are not applied to reshares and events --------------

  test "STG-1 a followers-only post cannot be reshared by someone who does not follow the author" do
    secret = Post.create!(author_type: "user", author_id: @alice.id, created_by: @alice, kind: "update", body: "Followers only gossip",
      visibility: "followers", status: "active")
    post "/api/stage/posts", params: { body: "Look at this", resharedPostId: secret.id }, headers: auth(@bob), as: :json
    assert_includes [403, 404, 422], response.status, "stranger resharing a followers-only post: #{response.status}"
    refute Post.where(reshared_post_id: secret.id).exists?
  end

  test "STG-1 a reshare preview never embeds a post that is now followers-only, hidden or deleted" do
    original = Post.create!(author_type: "user", author_id: @alice.id, created_by: @alice, kind: "update", body: "Original words", visibility: "public", status: "active")
    reshare = Post.create!(author_type: "user", author_id: @bob.id, created_by: @bob, kind: "update", body: "Sharing", visibility: "public", status: "active", reshared_post: original)

    get "/api/stage/posts/#{reshare.id}"
    assert_equal "Original words", response.parsed_body.dig("post", "sharedEntity", "post", "body")

    { "followers" => "visibility", "hidden" => "status", "deleted" => "status" }.each do |value, column|
      original.update_columns(visibility: "public", status: "active")
      original.update_columns(column => value)
      get "/api/stage/posts/#{reshare.id}"
      assert_response :success
      shared = response.parsed_body.dig("post", "sharedEntity")
      assert shared["unavailable"], "#{column}=#{value} original must render as unavailable, got #{shared.inspect}"
      assert_nil shared["post"]
    end
  end

  test "STG-3 followers-only event posts are not in the events strip or the calendar download for strangers" do
    event = Post.create!(author_type: "user", author_id: @alice.id, created_by: @alice, kind: "event", body: "Private jam", visibility: "followers",
      status: "active", event_title: "Secret jam", event_starts_at: 3.days.from_now, event_venue: "Hidden Cellar", city: "Mumbai")
    get "/api/stage/events?city=Mumbai", headers: auth(@bob)
    assert_response :success
    assert_empty response.parsed_body["events"], "followers-only event shown in the strip"
    get "/api/stage/posts/#{event.id}/ics"
    assert_response :not_found
  end

  # ---- AUTH-1: password reset has no per-account cap, so a victim's inbox can be flooded ------

  test "AUTH-1 password reset emails to one account are capped regardless of the requesting network" do
    victim = create_user("Victim Audit", "jobseeker")
    12.times do |index|
      post "/api/auth/forgot-password", params: { email: victim.email }, headers: { "REMOTE_ADDR" => "198.51.100.#{index + 1}" }, as: :json
      assert_response :success
    end
    assert_operator victim.email_tokens.where(purpose: "reset_password").count, :<=, 5
  end

  # ---- AUTH-2/3: account pre-hijacking -------------------------------------------------------

  test "AUTH-2 proving the mailbox with an email code ends access held by whoever registered the address first" do
    email = "pre-hijack-victim@example.com"
    post "/api/auth/register", params: { name: "Attacker Audit", email:, password: PASSWORD, role: "jobseeker" }, as: :json
    assert_response :created
    attacker_token = response.parsed_body["accessToken"]

    post "/api/auth/otp/request", params: { email: }, as: :json
    code = response.parsed_body["debugCode"]
    assert code
    post "/api/auth/otp/verify", params: { email:, code: }, as: :json
    assert_response :success

    get "/api/me", headers: { "Authorization" => "Bearer #{attacker_token}" }
    assert_response :unauthorized, "the pre-registration session survived the owner proving the mailbox"
    post "/api/auth/login", params: { email:, password: PASSWORD }, as: :json
    assert_response :unauthorized, "the pre-registration password still works"
  end

  test "AUTH-3 linking Google to an unverified account ends access held by whoever registered the address first" do
    email = "pre-hijack-google@example.com"
    post "/api/auth/register", params: { name: "Attacker Audit", email:, password: PASSWORD, role: "jobseeker" }, as: :json
    assert_response :created
    attacker_token = response.parsed_body["accessToken"]

    google_callback(email:) do
      assert_response :redirect
      assert_includes response.location, "auth=google"
    end

    get "/api/me", headers: { "Authorization" => "Bearer #{attacker_token}" }
    assert_response :unauthorized
    post "/api/auth/login", params: { email:, password: PASSWORD }, as: :json
    assert_response :unauthorized
  end

  test "AUTH-3 a verified account keeps its password and sessions when Google is linked" do
    token = session_token(@alice)
    google_callback(email: @alice.email) { assert_response :redirect }
    get "/api/me", headers: { "Authorization" => "Bearer #{token}" }
    assert_response :success
  end

  # ---- AUTH-4: Google sign-in sidesteps the admin sign-in lock -------------------------------

  test "AUTH-4 with ADMIN_ORIGIN set an admin cannot be signed in through Google" do
    admin = create_user("Admin Audit", "admin")
    with_env("ADMIN_ORIGIN" => "https://admin.example.invalid") do
      google_callback(email: admin.email) do
        assert_response :redirect
        assert_includes response.location, "auth_error="
        refute_includes response.location, "code="
      end
    end
  end

  # ---- UPL-1: uploads have no per-account rate limit ------------------------------------------

  test "UPL-1 presigning uploads is rate limited per account" do
    statuses = Array.new(130) do
      post "/api/uploads/presign", params: { contentType: "image/png", size: 1000, filename: "a.png" }, headers: auth(@alice), as: :json
      response.status
    end
    assert_includes statuses, 429
  end

  # ---- ORG-1: workspace invites enumerate accounts and notify them with no limit --------------

  test "ORG-1 adding workspace members by email is rate limited" do
    Subscription.create!(user: @hirer, plan_code: "studio", provider: "internal", status: "active", current_period_start: Time.current, current_period_end: 30.days.from_now)
    org = Organization.create!(owner: @hirer, name: "Audit Org", status: "active")
    org.organization_members.create!(user: @hirer, role: "owner")
    statuses = Array.new(40) do |index|
      post "/api/organizations/#{org.id}/members", params: { email: "nobody-#{index}@example.com", role: "member" }, headers: auth(@hirer), as: :json
      response.status
    end
    assert_includes statuses, 429, "an account can probe unlimited addresses for existence"
  end

  # ---- SSRF-1: link importer block list misses reserved ranges --------------------------------

  test "SSRF-1 the link importer refuses reserved and transition-mechanism addresses" do
    %w[0.0.0.0 127.0.0.1 10.1.2.3 172.16.0.1 192.168.1.1 169.254.169.254 100.64.0.1 ::1 ::
       198.18.0.1 192.0.0.8 224.0.0.1 255.255.255.255 ff02::1 fec0::1 64:ff9b::7f00:1 2002:7f00:1::1 ::ffff:127.0.0.1].each do |address|
      assert LinkImport::SafeFetch.blocked_address?(address), "#{address} must be blocked"
    end
    refute LinkImport::SafeFetch.blocked_address?("93.184.216.34")
    refute LinkImport::SafeFetch.blocked_address?("2606:2800:220:1:248:1893:25c8:1946")
  end

  # ---- EXP-1 / ERASE-1: export and erasure completeness (DPDP) --------------------------------

  test "EXP-1 the data export covers Stage activity, urgent requests, shortlists, folders and vouches" do
    post_row = Post.create!(author_type: "user", author_id: @alice.id, created_by: @alice, kind: "update", body: "My stage post", visibility: "public", status: "active")
    PostComment.create!(post: post_row, author_type: "user", author_id: @alice.id, created_by: @alice, body: "My stage comment", status: "active")
    UrgentRequest.create!(requester: @alice, title: "Need a bassist", role_name: "Bassist", city: "Pune", start_at: 2.days.from_now, currency: "INR", status: "open")
    TalentShortlist.create!(employer: @alice, candidate: @bob, note: "Shortlist note")
    TalentFolder.create!(owner: @alice, name: "My folder")

    get "/api/account/export", headers: auth(@alice)
    assert_response :success
    export = response.parsed_body
    assert_includes export.fetch("stagePosts").map { _1["body"] }, "My stage post"
    assert_includes export.fetch("stageComments").map { _1["body"] }, "My stage comment"
    assert_equal ["Need a bassist"], export.fetch("urgentRequests").map { _1["title"] }
    assert_equal ["Shortlist note"], export.fetch("shortlists").map { _1["note"] }
    assert_equal ["My folder"], export.fetch("talentFolders").map { _1["name"] }
  end

  test "ERASE-1 deleting an account removes the third-party addresses and billing details it held" do
    @alice.profile.update!(verified: true)
    Vouch.create!(voucher: @alice, vouchee_email: "someone.vouched@example.com")
    org = Organization.create!(owner: @alice, name: "Alice Org", status: "active", tax_id: "27ABCDE1234F1Z5", billing_email: "billing@alice-org.example.com")
    org.organization_members.create!(user: @alice, role: "owner")

    delete "/api/account", params: { confirmEmail: @alice.email }, headers: auth(@alice), as: :json
    assert_response :success

    assert_empty Vouch.where(voucher_id: @alice.id), "vouchee email addresses outlive the voucher"
    org.reload
    assert_nil org.tax_id
    assert_nil org.billing_email
  end

  # ---- Regression guards (areas audited and found sound) --------------------------------------

  test "admin API answers neither anonymous callers nor non-admin roles, and honours ADMIN_ORIGIN" do
    admin = create_user("Admin Guard", "admin")
    routes = Rails.application.routes.routes.select { _1.path.spec.to_s.start_with?("/api/admin/") && _1.verb.present? }
    assert_operator routes.size, :>, 50
    with_env("ADMIN_ORIGIN" => "https://admin.example.invalid") do
      routes.each do |route|
        verb = route.verb.downcase
        path = route.path.spec.to_s.sub("(.:format)", "").gsub(/:\w+/, "missing_id")
        [[{}, 403], [auth(@alice), 403], [auth(@hirer), 403], [auth(admin).merge("Origin" => "https://evil.example.invalid"), 403]].each do |headers, expected|
          send(verb, path, headers:, as: :json)
          assert_equal expected, response.status, "#{verb.upcase} #{path} as #{headers.keys.inspect}"
        end
      end
    end
    routes.each do |route|
      verb = route.verb.downcase
      path = route.path.spec.to_s.sub("(.:format)", "").gsub(/:\w+/, "missing_id")
      [{}, auth(@alice), auth(@hirer)].each do |headers|
        send(verb, path, headers:, as: :json)
        assert_includes [401, 403], response.status, "#{verb.upcase} #{path} without admin rights answered #{response.status}"
      end
    end
  end

  test "Action Mailbox ingress and conductor routes are not reachable" do
    post "/rails/action_mailbox/relay/inbound_emails", params: "From: a@b.c\r\n\r\nhi", headers: { "Content-Type" => "message/rfc822" }
    assert_includes [401, 404, 422], response.status
  end

  private

  def assert_internal_columns_absent(row, delivery: false)
    assert row, "row expected"
    (%w[founder_notes expiry_warned_at] + (delivery ? %w[notified_count first_notified_at last_notified_at] : [])).each do |column|
      refute row.key?(column), "#{column} is an admin-only column and must not be in the payload"
    end
  end

  def auth(user) = { "Authorization" => "Bearer #{session_token(user)}" }

  def session_token(user)
    @tokens ||= {}
    @tokens[user.id] ||= SecureRandom.urlsafe_base64(48).tap do |raw|
      Session.start!(user, token_digest: Digest::SHA256.hexdigest(raw), user_agent: nil)
    end
  end

  def create_user(name, role, **profile)
    @seq += 1
    user = User.create!(name:, email: "audit-#{@seq}-#{SecureRandom.hex(3)}@example.com", password: PASSWORD, role:, status: "active", profile_complete: true, email_verified: true)
    user.create_profile!(profile) unless role == "admin"
    user
  end

  GOOGLE_ENV = { "GOOGLE_OAUTH_CLIENT_ID" => "client-123", "GOOGLE_OAUTH_CLIENT_SECRET" => "secret-abc",
    "API_URL" => "https://api.example.invalid", "FRONTEND_URL" => "https://app.example.invalid" }.freeze

  # Runs one Google callback for a verified Google identity with `email`, yielding afterwards for the assertions.
  def google_callback(email:)
    key = OpenSSL::PKey::RSA.new(2048)
    jwk = JWT::JWK.new(key)
    Rails.cache.write(GoogleOauth::JWKS_CACHE_KEY, [jwk.export(include_private: false).merge(alg: "RS256", use: "sig")], expires_in: 1.hour)
    id_token = JWT.encode({ sub: "sub-#{email}", email:, email_verified: true, name: "Google Person", iss: "https://accounts.google.com",
      aud: "client-123", exp: 1.hour.from_now.to_i }, key, "RS256", { kid: jwk.kid })
    original = GoogleOauth.method(:exchange_code)
    GoogleOauth.define_singleton_method(:exchange_code) { |code:, code_verifier:, client: nil| { id_token:, access_token: "t", refresh_token: nil, expires_in: 3600 } }
    state = Rails.application.message_verifier("google-oauth-state").generate(
      { "csrf" => "x", "verifier" => "v", "intent" => "signin", "role" => "jobseeker", "return_to" => nil, "consent" => true, "ticket" => nil },
      purpose: :google_oauth_state, expires_in: 10.minutes
    )
    with_env(GOOGLE_ENV) do
      get "/auth/google/callback?code=fake-code&state=#{state}"
      yield
    end
  ensure
    GoogleOauth.define_singleton_method(:exchange_code, original) if original
  end

  def with_env(values)
    old = values.to_h { |key, _| [key.to_s, ENV[key.to_s]] }
    values.each { |key, value| value.nil? ? ENV.delete(key.to_s) : ENV[key.to_s] = value }
    yield
  ensure
    old&.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
