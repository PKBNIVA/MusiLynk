require "test_helper"
require "minitest/mock"
require "openssl"

# Independent review (PR 151): reproductions for gaps the audit missed. Each test FAILS on the audited branch.
class SecurityReview202610Test < ActionDispatch::IntegrationTest
  PASSWORD = "StrongPass123!".freeze

  setup do
    @seq = 0
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @alice = create_user("Alice Rev", "jobseeker", location: "Mumbai", roles: ["Drummer"])
    @bob = create_user("Bob Rev", "jobseeker", location: "Mumbai", roles: ["Drummer"])
    @hirer_user = create_user("Hirer Rev", "employer", company_name: "Rev Studio")
  end

  teardown { Rails.cache = @original_cache }

  test "REV-1 password reset must not sign in an admin on the public origin without the second factor" do
    admin = create_user("Admin Rev", "admin")
    with_env("ADMIN_ORIGIN" => "https://admin.example.invalid") do
      post "/api/auth/forgot-password", params: { email: admin.email }, as: :json
      raw = SecureRandom.urlsafe_base64(32)
      EmailToken.create!(user: admin, purpose: "reset_password", token_digest: Digest::SHA256.hexdigest(raw), expires_at: 2.hours.from_now)
      post "/api/auth/reset-password", params: { token: raw, password: "BrandNewPass456!" }, as: :json
      assert_nil response.parsed_body["accessToken"], "reset-password handed an admin session to a public-origin caller with no password and no emailed second factor"
    end
  end

  test "REV-2 the attacker's connected Google account does not survive the victim proving the mailbox" do
    email = "pre-hijack-conn@example.com"
    post "/api/auth/register", params: { name: "Attacker Rev", email:, password: PASSWORD, role: "jobseeker" }, as: :json
    assert_response :created
    victim_account = User.find_by!(email:)
    # What POST /auth/google/start?intent=connect does for an unverified account (GoogleSignIn#connect! has no verified-email check).
    AuthConnection.create!(owner: victim_account, provider: "google", provider_uid: "sub-attacker-own-google@example.com", email: "attacker-own-google@example.com")

    post "/api/auth/otp/request", params: { email: }, as: :json
    post "/api/auth/otp/verify", params: { email:, code: response.parsed_body["debugCode"] }, as: :json
    assert_response :success

    # The pre-linked identity is gone, so that Google account is now just a stranger: it is either refused or it
    # gets a brand-new account of its own. What it must never do is sign in to the victim's account.
    google_callback(email: "attacker-own-google@example.com") do
      assert_response :redirect
      if response.location.include?("code=")
        code = Rack::Utils.parse_query(URI.parse(response.location).query)["code"]
        post "/api/auth/exchange", params: { code: }, as: :json
        assert_not_equal victim_account.id, response.parsed_body.dig("user", "id"),
          "the attacker still signs in to the victim's account through the Google identity they linked before the mailbox was proven"
      end
    end
    assert_empty victim_account.reload.auth_connections
    assert_nil victim_account.phone
  end

  test "REV-2 a Google identity pre-linked to an unverified account with a different email is reclaimed before it can sign in" do
    email = "pre-linked-unverified@example.com"
    post "/api/auth/register", params: { name: "Attacker Rev", email:, password: PASSWORD, role: "jobseeker" }, as: :json
    victim_account = User.find_by!(email:)
    victim_account.update_columns(phone: "+919800000001", phone_verified_at: Time.current)
    AuthConnection.create!(owner: victim_account, provider: "google", provider_uid: "sub-attacker-own-google@example.com", email: "attacker-own-google@example.com")
    google_callback(email: "attacker-own-google@example.com") do
      assert_response :redirect
      if response.location.include?("code=")
        post "/api/auth/exchange", params: { code: Rack::Utils.parse_query(URI.parse(response.location).query)["code"] }, as: :json
        assert_not_equal victim_account.id, response.parsed_body.dig("user", "id")
      end
    end
    assert_empty victim_account.reload.auth_connections
    assert_nil victim_account.phone
    assert_nil victim_account.phone_verified_at
  end

  # Decision (owner's delegate): a password set before the mailbox was proven is dropped, because it may belong
  # to a stranger who registered the address first; we cannot tell that apart from an honest sign-up. To keep
  # it humane the now-verified owner gets a notice email and the login response points at the email-code path.
  test "REV-3 a password set before the mailbox was proven is removed, the owner is told, and login points at email codes" do
    email = "honest@example.com"
    post "/api/auth/register", params: { name: "Honest Rev", email:, password: PASSWORD, role: "jobseeker" }, as: :json
    assert_response :created
    post "/api/auth/otp/request", params: { email: }, as: :json
    code = response.parsed_body["debugCode"]
    with_env("EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send", "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil) do
      assert_enqueued_jobs 1, only: EmailDeliveryJob do
        post "/api/auth/otp/verify", params: { email:, code: }, as: :json
      end
      assert_response :success
      notice = enqueued_jobs.find { _1[:job] == EmailDeliveryJob }
      _uid, template, _detail, sealed_email = ActiveJob::Arguments.deserialize(notice[:args])
      assert_equal "account_password_removed", template
      assert_equal email, EmailDeliveryJob.unseal(sealed_email, purpose: EmailDeliveryJob::RECIPIENT_PURPOSE)
    end
    post "/api/auth/login", params: { email:, password: PASSWORD }, as: :json
    assert_response :unauthorized
    assert_equal "USE_EMAIL_CODE", response.parsed_body["code"]
    assert_not User.find_by!(email:).password_set?
  end

  test "REV-4 editing a followers-only post's body keeps it followers-only" do
    post "/api/stage/posts", params: { body: "just for followers", visibility: "followers" }, headers: auth(@alice), as: :json
    assert_response :created
    id = response.parsed_body["id"]
    patch "/api/stage/posts/#{id}", params: { body: "just for followers (typo fixed)" }, headers: auth(@alice), as: :json
    assert_response :success
    assert_equal "followers", Post.find(id).visibility, "an edit that did not mention visibility made the post public"
  end

  test "REV-5 a portfolio_share post stops embedding the item once the owner makes it private" do
    item = PortfolioItem.create!(user: @alice, kind: "video", title: "Secret demo", url: "https://www.youtube.com/watch?v=abc123", visibility: "public")
    post "/api/stage/posts", params: { kind: "portfolio_share", sharedPortfolioItemId: item.id, body: "look" }, headers: auth(@alice), as: :json
    assert_response :created
    id = response.parsed_body["id"]
    item.update_columns(visibility: "private")
    get "/api/stage/posts/#{id}", headers: auth(@bob), as: :json
    assert_response :success
    refute_includes response.body, "Secret demo", "a private portfolio item is still readable through the old share post"
  end

  test "REV-6 AI top-up with an Idempotency-Key header does not 500" do
    with_env("AI_BILLING_ENABLED" => "true") do
      post "/api/ai/topups", params: { pack: AiPricing.topups.keys.first.to_s }, headers: auth(@alice).merge("Idempotency-Key" => "abc"), as: :json
      assert_response :success
    end
  end

  test "REV-7 erasing a voucher does not delete the vouch evidence that belongs to the person they vouched for" do
    @alice.profile.update!(verified: true)
    vouch = Vouch.create!(voucher: @alice, vouchee_email: @bob.email)
    vouch.update_columns(status: "joined", vouchee_id: @bob.id)

    delete "/api/account", params: { confirmEmail: @alice.email }, headers: auth(@alice), as: :json
    assert_response :success

    assert Vouch.exists?(vouch.id), "Bob's joined vouch (verification evidence) was deleted by Alice's erasure"
  end

  test "REV-8 export works for an account with a connected Google sign-in and omits provider tokens" do
    AuthConnection.create!(owner: @alice, provider: "google", provider_uid: "sub-1", email: "a@gmail.example", access_token: "SECRET-ACCESS", refresh_token: "SECRET-REFRESH")
    get "/api/account/export", headers: auth(@alice)
    assert_response :success
    refute_includes response.body, "SECRET-ACCESS"
    refute_includes response.body, "SECRET-REFRESH"
    assert_equal 1, JSON.parse(response.body).fetch("connectedAccounts").size
  end

  test "REV-1 reset-password never signs in an admin, and forgot-password sends admins nothing under the admin lock" do
    admin = create_user("Admin Rev2", "admin")
    with_env("ADMIN_ORIGIN" => "https://admin.example.invalid") do
      post "/api/auth/forgot-password", params: { email: admin.email }, as: :json
      assert_response :success
      assert_equal 0, admin.email_tokens.where(purpose: "reset_password").count, "a reset token was issued to an admin while the admin lock is on"
    end
    raw = SecureRandom.urlsafe_base64(32)
    EmailToken.create!(user: admin, purpose: "reset_password", token_digest: Digest::SHA256.hexdigest(raw), expires_at: 2.hours.from_now)
    post "/api/auth/reset-password", params: { token: raw, password: "BrandNewPass456!" }, as: :json
    assert_response :success
    assert_nil response.parsed_body["accessToken"]
    assert_equal 0, admin.sessions.count
    assert admin.reload.authenticate("BrandNewPass456!"), "the admin's password is still reset"
  end

  test "REV-4 an edit that names a field changes it, and one that does not leaves it" do
    post "/api/stage/posts", params: { body: "x", visibility: "followers", genres: ["Jazz"] }, headers: auth(@alice), as: :json
    id = response.parsed_body["id"]
    patch "/api/stage/posts/#{id}", params: { city: "Pune" }, headers: auth(@alice), as: :json
    assert_response :success
    post_row = Post.find(id)
    assert_equal ["followers", ["Jazz"], "x", "Pune"], [post_row.visibility, post_row.genres, post_row.body, post_row.city]
    patch "/api/stage/posts/#{id}", params: { visibility: "public", genres: [] }, headers: auth(@alice), as: :json
    post_row.reload
    assert_equal ["public", []], [post_row.visibility, post_row.genres]
  end

  test "REV-5 share previews carry public-view fields only and job shares need the poster's own published listing" do
    item = PortfolioItem.create!(user: @alice, kind: "video", title: "Public demo", url: "https://www.youtube.com/watch?v=abc123", visibility: "public", media_metadata: { "internal" => "x" })
    post "/api/stage/posts", params: { kind: "portfolio_share", sharedPortfolioItemId: item.id, body: "look" }, headers: auth(@alice), as: :json
    get "/api/stage/posts/#{response.parsed_body["id"]}", headers: auth(@bob), as: :json
    shared = response.parsed_body.dig("post", "sharedEntity", "item")
    assert_equal "Public demo", shared["title"]
    assert_not shared.key?("mediaMetadata")
    assert_not shared.key?("sortOrder")

    mine = create_job(@hirer_user, "published")
    pending = create_job(@hirer_user, "pending")
    theirs = create_job(@bob, "published")
    { mine => 201, pending => 422, theirs => 422 }.each do |job, status|
      post "/api/stage/posts", params: { kind: "job_share", sharedJobId: job.id, body: "hiring" }, headers: auth(@hirer_user), as: :json
      assert_equal status, response.status, "job_share of #{job.status} job #{job.employer_id == @hirer_user.id ? 'own' : 'foreign'}"
    end
    shared_post = Post.where(shared_job_id: mine.id).first
    mine.update_columns(status: "closed")
    get "/api/stage/posts/#{shared_post.id}", headers: auth(@bob), as: :json
    assert response.parsed_body.dig("post", "sharedEntity", "unavailable"), "a closed listing is still embedded in the old share"
  end

  test "REV-6 AI top-up with an Idempotency-Key reuses the open order and fails closed without Razorpay keys in production" do
    with_env("AI_BILLING_ENABLED" => "true") do
      production = ActiveSupport::EnvironmentInquirer.new("production")
      with_env("RAZORPAY_KEY_ID" => nil, "RAZORPAY_KEY_SECRET" => nil) do
        Rails.stub(:env, production) do
          post "/api/ai/topups", params: { pack: AiPricing.topups.keys.first.to_s }, headers: auth(@alice), as: :json
        end
        assert_response :service_unavailable
        assert_equal 0, AiTopupPayment.where(user: @alice).count
      end
      payment = AiTopupPayment.create!(user: @alice, pack: AiPricing.topups.keys.first.to_s, amount: 100, currency: "INR", credits: 10, provider: "razorpay", status: "created", provider_order_id: "order_x")
      with_env("RAZORPAY_KEY_ID" => nil, "RAZORPAY_KEY_SECRET" => "") do
        post "/api/ai/topups/verify", params: { paymentRecordId: payment.id, orderId: "order_x", paymentId: "pay_1", signature: OpenSSL::HMAC.hexdigest("SHA256", "", "order_x|pay_1") }, headers: auth(@alice), as: :json
        assert_response :service_unavailable
        assert_equal "created", payment.reload.status, "a signature made with the empty key credited the account"
      end
    end
  end

  test "REV-7 erasing a voucher deletes only invitations nobody accepted" do
    @alice.profile.update!(verified: true)
    joined = Vouch.create!(voucher: @alice, vouchee_email: @bob.email)
    joined.update_columns(status: "joined", vouchee_id: @bob.id)
    invited = Vouch.create!(voucher: @alice, vouchee_email: "never.joined@example.com")
    delete "/api/account", params: { confirmEmail: @alice.email }, headers: auth(@alice), as: :json
    assert_response :success
    assert_not Vouch.exists?(invited.id)
    assert Vouch.exists?(joined.id)
    assert_equal "Deleted account", joined.voucher.reload.name
  end

  test "Razorpay webhook de-duplicates on the signed body, not the unsigned event-id header" do
    with_env("RAZORPAY_WEBHOOK_SECRET" => "whsec_review") do
      send_hook = lambda do |body, event_id|
        raw = body.to_json
        post "/api/billing/webhook/razorpay", params: raw, headers: { "Content-Type" => "application/json", "X-Razorpay-Event-Id" => event_id,
          "X-Razorpay-Signature" => OpenSSL::HMAC.hexdigest("SHA256", "whsec_review", raw) }
      end
      send_hook.call({ event: "payment.noop", payload: { n: 1 } }, "evt_same")
      assert_response :success
      send_hook.call({ event: "payment.noop", payload: { n: 2 } }, "evt_same")
      assert_response :success
      assert_nil response.parsed_body["duplicate"], "a different signed body was dropped because a replayed header matched an earlier event"
      send_hook.call({ event: "payment.noop", payload: { n: 2 } }, "evt_other")
      assert_equal true, response.parsed_body["duplicate"]
    end
  end

  test "AUTH-1 a live reset token is not re-sent, so repeated requests cannot silence the owner" do
    victim = create_user("Victim Rev", "jobseeker")
    4.times { post "/api/auth/forgot-password", params: { email: victim.email }, as: :json }
    assert_equal 1, victim.email_tokens.where(purpose: "reset_password").count
    travel 11.minutes do
      post "/api/auth/forgot-password", params: { email: victim.email }, as: :json
      assert_equal 2, victim.email_tokens.where(purpose: "reset_password").count, "the owner could not get a fresh link later in the hour"
    end
  end

  test "UPL-1 the cap counts one hit per file in both storage modes" do
    pairs = Array.new(70) do
      post "/api/uploads/presign", params: { contentType: "image/png", size: 1000, filename: "a.png" }, headers: auth(@alice), as: :json
      first = response.status
      put "/api/uploads/local", params: "x", headers: auth(@alice).merge("Content-Type" => "image/png"), as: :json
      [first, response.status]
    end
    assert_empty pairs.flatten.select { _1 == 429 }, "a presign + local upload pair is counted twice"
    statuses = Array.new(70) do
      put "/api/uploads/local", params: "x", headers: auth(@alice).merge("Content-Type" => "image/png")
      response.status
    end
    assert_includes statuses, 429
    with_env("AWS_BUCKET" => "b", "AWS_ACCESS_KEY_ID" => "k", "AWS_SECRET_ACCESS_KEY" => "s", "AWS_REGION" => "ap-south-1", "AWS_ENDPOINT_URL_S3" => nil, "AWS_PUBLIC_BASE_URL" => nil) do
      direct = Array.new(130) do
        post "/api/uploads/presign", params: { contentType: "image/png", size: 1000, filename: "a.png" }, headers: auth(@bob), as: :json
        response.status
      end
      assert_includes direct, 429
    end
  end

  test "DEC-4a password sign-in is refused until the email is verified, with a resend path" do
    email = "unverified@example.com"
    post "/api/auth/register", params: { name: "Unverified Rev", email:, password: PASSWORD, role: "jobseeker" }, as: :json
    assert_response :created
    post "/api/auth/login", params: { email:, password: PASSWORD }, as: :json
    assert_response :forbidden
    assert_equal "EMAIL_VERIFICATION_REQUIRED", response.parsed_body["code"]
    with_env("EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send", "BREVO_API_KEY" => nil, "RESEND_API_KEY" => nil) do
      assert_enqueued_jobs 1, only: EmailDeliveryJob do
        post "/api/auth/resend-verification", params: { email: }, as: :json
      end
      assert_response :success
      assert_no_enqueued_jobs only: EmailDeliveryJob do
        post "/api/auth/resend-verification", params: { email: "nobody@example.com" }, as: :json
      end
      assert_response :success
    end
    User.find_by!(email:).update_columns(email_verified: true)
    post "/api/auth/login", params: { email:, password: PASSWORD }, as: :json
    assert_response :success
  end

  test "DEC-4b Google callback needs the cookie set by /auth/google/start (login CSRF)" do
    with_env(GOOGLE_ENV) do
      get "/auth/google/start?intent=signin&role=jobseeker"
      assert_response :redirect
      cookie = response.headers["Set-Cookie"].to_s
      assert_includes cookie, "#{GoogleAuthController::STATE_COOKIE}="
      %w[httponly secure samesite=lax].each { assert_includes cookie.downcase, _1 }
      state = Rack::Utils.parse_query(URI.parse(response.location).query)["state"]
      get "/auth/google/callback?code=c&state=#{CGI.escape(state)}"
      assert_includes response.location, "auth_error=state_mismatch", "callback accepted a state with no browser cookie"
      get "/auth/google/callback?code=c&state=#{CGI.escape(state)}", headers: { "Cookie" => oauth_cookie("some-other-nonce") }
      assert_includes response.location, "auth_error=state_mismatch"
    end
  end

  test "DEC-4d private fields are trimmed from hirer, workspace, booking and deleted-account payloads" do
    hirer = @hirer_user
    job = create_job(hirer, "published")
    Application.create!(job:, candidate: @alice, cover_letter: "Hi", status: "Shortlisted")
    get "/api/employer/applications", headers: auth(hirer)
    assert_response :success
    assert response.parsed_body["applications"].any?
    assert response.parsed_body["applications"].none? { _1.key?("candidateEmail") }

    org = Organization.create!(owner: hirer, name: "Org Rev", status: "active", tax_id: "27ABCDE1234F1Z5", billing_email: "bill@org.example.com")
    org.organization_members.create!(user: hirer, role: "owner")
    org.organization_members.create!(user: @alice, role: "member")
    get "/api/organizations", headers: auth(@alice)
    row = response.parsed_body["organizations"].find { _1["id"] == org.id }
    assert_not row.key?("tax_id")
    assert_not row.key?("billing_email")
    get "/api/organizations", headers: auth(hirer)
    assert_equal "27ABCDE1234F1Z5", response.parsed_body["organizations"].find { _1["id"] == org.id }["tax_id"]

    act = Act.create!(owner: @bob, name: "Bob Band", act_type: "band", status: "active", currency: "INR", fee_basis: "event")
    booking = BookingRequest.create!(act:, requester: hirer, event_type: "wedding", city: "Mumbai", currency: "INR", status: "accepted", event_date: 30.days.from_now)
    quote = booking.booking_quotes.create!(created_by: @bob, performance_fee: 1000, currency: "INR", status: "accepted", deposit_percent: 50)
    booking.booking_payments.create!(booking_quote: quote, payer: hirer, kind: "deposit", amount: 500, currency: "INR", provider: "razorpay", status: "paid", provider_order_id: "order_secret", provider_payment_id: "pay_secret")
    [@bob, hirer].each do |viewer|
      get "/api/bookings/#{booking.id}/payments", headers: auth(viewer)
      assert_response :success
      payment = response.parsed_body["payments"].first
      assert_equal "paid", payment["status"]
      %w[provider_order_id provider_payment_id payer_id provider booking_quote_id].each { assert_not payment.key?(_1), "#{_1} leaked to #{viewer.id == hirer.id ? 'payer' : 'act owner'}" }
    end

    gone = create_user("Gone Rev", "employer")
    gone_job = create_job(gone, "published")
    gone_job.update_columns(status: "closed")
    get "/api/jobs/#{gone_job.id}"
    assert_response :success
    gone.update_columns(status: "deleted")
    get "/api/jobs/#{gone_job.id}"
    assert_response :not_found
  end

  test "DEC-4d erasing an account redacts the emails and addresses in its audit trail" do
    AuditLog.create!(actor: @alice, action: "account.email_changed", entity_type: "User", entity_id: @alice.id, metadata: { "from" => "old@example.com", "to" => @alice.email })
    AuditLog.create!(actor: @alice, action: "auth.login", entity_type: "User", entity_id: @alice.id, metadata: { "ip" => "203.0.113.9", "method" => "password" })
    delete "/api/account", params: { confirmEmail: @alice.email }, headers: auth(@alice), as: :json
    assert_response :success
    blob = AuditLog.where(actor_id: @alice.id).pluck(:metadata).to_json
    %w[old@example.com 203.0.113.9].each { assert_not_includes blob, _1 }
    assert_not_includes blob, @alice.email
    assert_includes blob, "password", "non-personal metadata is kept"
  end

  private

  def create_job(owner, status)
    Job.create!(employer: owner, title: "Gig #{SecureRandom.hex(2)}", company: "Rev Co", location: "Mumbai", kind: "Project-based", genre: "Jazz",
      description: "A long enough description for the listing to be valid and published without complaint. " * 2, status:, published_at: (Time.current if status == "published"))
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
      get "/auth/google/callback?code=fake-code&state=#{state}", headers: { "Cookie" => oauth_cookie("x") }
      yield
    end
  ensure
    GoogleOauth.define_singleton_method(:exchange_code, original) if original
  end

  def oauth_cookie(nonce)
    value = Rails.application.message_verifier("google-oauth-state-cookie").generate(nonce, purpose: :google_oauth_state_cookie, expires_in: 10.minutes)
    "#{GoogleAuthController::STATE_COOKIE}=#{CGI.escape(value)}"
  end

  def with_env(values)
    old = values.to_h { |key, _| [key.to_s, ENV[key.to_s]] }
    values.each { |key, value| value.nil? ? ENV.delete(key.to_s) : ENV[key.to_s] = value }
    yield
  ensure
    old&.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
