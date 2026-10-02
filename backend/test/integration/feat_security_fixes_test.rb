require "test_helper"
require "minitest/mock"
require_relative "../support/showcase_helpers"
require_relative "../support/push_helpers"

# Security review of the combined features branch: invite tokens in analytics, erasure and export of the
# new tables, push key validation and isolation, problem-report blob cleanup, and invite abuse limits.
class FeatSecurityFixesTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper
  include ShowcaseHelpers
  include PushHelpers

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  # --- Analytics never stores invite tokens --------------------------------------------------

  test "an invite token reported as page or path is stored redacted" do
    post "/api/events", params: { events: [
      { name: "route_change", anonId: "a", props: { path: "/invites/TOKENVALUE123?x=1", note: "from /invites/TOKENVALUE123" }, page: "/invites/TOKENVALUE123" },
      { name: "route_change", anonId: "b", props: { path: "/reset-password?token=ABC" }, page: "/verify-email?t=ABC" }
    ] }, as: :json
    assert_response :success
    rows = ProductEvent.where(anon_id: %w[a b]).order(:anon_id).to_a
    assert_equal "/invites/:token", rows[0].page
    assert_equal "/invites/:token", rows[0].props["path"]
    assert_equal "from /invites/:token", rows[0].props["note"]
    assert_equal "/verify-email", rows[1].page
    assert_equal "/reset-password", rows[1].props["path"]
    assert_not_includes ProductEvent.all.map { _1.attributes.to_json }.join, "TOKENVALUE123"
  end

  test "the data migration redacts stored invite paths and its down is a no-op" do
    ProductEvent.insert_all([
      { id: "prod_a", anon_id: "m", name: "route_change", page: "/invites/SECRETONE", props: { "path" => "/invites/SECRETONE", "keep" => "x" }, created_at: Time.current },
      { id: "prod_b", anon_id: "m", name: "route_change", page: "/acts/act_1", props: { "path" => "/acts/act_1" }, created_at: Time.current }
    ])
    require Rails.root.join("db/migrate/20261002160000_redact_invite_tokens_in_product_events.rb").to_s
    migration = RedactInviteTokensInProductEvents.new
    ActiveRecord::Migration.suppress_messages { migration.up }
    a = ProductEvent.find("prod_a")
    assert_equal "/invites/:token", a.page
    assert_equal({ "path" => "/invites/:token", "keep" => "x" }, a.props)
    assert_equal "/acts/act_1", ProductEvent.find("prod_b").page
    ActiveRecord::Migration.suppress_messages { migration.down }
    assert_equal "/invites/:token", ProductEvent.find("prod_a").page
  end

  # --- Erasure and export --------------------------------------------------------------------

  def screenshot_blob
    ActiveStorage::Blob.create_and_upload!(io: StringIO.new("\x89PNG\r\n\x1A\n".b + ("\0".b * 32)), filename: "s.png", content_type: "image/png", identify: false, metadata: { analyzed: true })
  end

  test "erasure removes push subscriptions, problem reports (and screenshots) and invites" do
    user = make_user("Erase Me")
    owner = make_user("Band Owner")
    sub = make_subscription(user)
    other_sub = make_subscription(owner)
    blob = screenshot_blob
    report = ProblemReport.create!(user:, description: "My phone is 9876543210", screenshot_blob: blob)
    anon_report = ProblemReport.create!(email: user.email.upcase.downcase, description: "signed out report")
    kept_report = ProblemReport.create!(user: owner, description: "someone else")
    act = make_act(owner)
    sent = ActInvite.create!(act:, inviter: user, kind: "email", invitee_email: "third.party@example.com", role_name: "Keys", token_digest: ActInvite.digest("x"), expires_at: 7.days.from_now)
    received = ActInvite.create!(act:, inviter: owner, kind: "user", invitee_user: user, role_name: "Keys", token_digest: ActInvite.digest("y"), expires_at: 7.days.from_now)
    to_address = ActInvite.create!(act:, inviter: owner, kind: "email", invitee_email: user.email, role_name: "Keys", token_digest: ActInvite.digest("z"), expires_at: 7.days.from_now)
    own_act = make_act(user, "Mine")
    own_act_invite = ActInvite.create!(act: own_act, inviter: owner, kind: "email", invitee_email: "bystander@example.com", role_name: "Bass", token_digest: ActInvite.digest("w"), expires_at: 7.days.from_now)
    unrelated = ActInvite.create!(act:, inviter: owner, kind: "email", invitee_email: "bystander2@example.com", role_name: "Bass", token_digest: ActInvite.digest("v"), expires_at: 7.days.from_now)

    AccountErasure.new(user).call!

    assert_not PushSubscription.exists?(sub.id)
    assert PushSubscription.exists?(other_sub.id)
    assert_not ProblemReport.exists?(report.id)
    assert_not ProblemReport.exists?(anon_report.id)
    assert ProblemReport.exists?(kept_report.id)
    assert_not ActiveStorage::Blob.exists?(blob.id), "screenshot blob must be purged"
    [sent, received, to_address, own_act_invite].each { |invite| assert_not ActInvite.exists?(invite.id) }
    assert ActInvite.exists?(unrelated.id)
  end

  test "erasure deletes saved billing profiles and keeps issued invoices" do
    source = File.read(Rails.root.join("app/services/account_erasure.rb"))
    assert_match(/BillingProfile\.where\(user_id: @user\.id\)\.delete_all/, source)
    assert_no_match(/TaxInvoice/, source, "issued tax invoices are retained for statutory reasons")
  end

  test "export includes push devices, problem reports and invites without secrets" do
    user = make_user("Export Me")
    owner = make_user("Export Owner")
    sub = make_subscription(user, user_agent_summary: "Chrome on Android")
    ProblemReport.create!(user:, description: "Something broke", expected: "It works", page: "/dashboard", screenshot_blob: screenshot_blob)
    act = make_act(owner)
    ActInvite.create!(act:, inviter: owner, kind: "user", invitee_user: user, role_name: "Keys", token_digest: ActInvite.digest("recv-secret"), expires_at: 7.days.from_now)
    ActInvite.create!(act:, inviter: user, kind: "email", invitee_email: "friend@example.com", role_name: "Bass", token_digest: ActInvite.digest("sent-secret"), expires_at: 7.days.from_now)

    get "/api/account/export", headers: auth(user)
    assert_response :success
    data = response.parsed_body

    assert_equal [{ "user_agent_summary" => "Chrome on Android", "created_at" => data["pushDevices"].first["created_at"], "last_success_at" => nil }], data["pushDevices"]
    report = data["problemReports"].sole
    assert_equal "Something broke", report["description"]
    assert_equal true, report["screenshotAttached"]
    assert_equal %w[received sent], data["actInvites"].map { _1["direction"] }.sort
    assert_includes data["actInvites"].map { _1["inviteeEmail"] }, "f***@example.com"
    assert data.key?("billingProfiles")
    assert data.key?("invoices")
    body = response.body
    [sub.endpoint, sub.p256dh, sub.auth, "token_digest", ActInvite.digest("recv-secret"), "friend@example.com"].each { assert_not_includes body, _1 }
  end

  # --- Push -----------------------------------------------------------------------------------

  test "push endpoint host allow-list rejects bypass attempts" do
    [
      "https://fcm.googleapis.com@evil.example/x", "https://evil.example\\@fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x",
      "https://evilfcm.googleapis.com.evil/x", "https://fcm.googleapis.com:8443/x", "http://fcm.googleapis.com/x", "https://127.0.0.1/x",
      "https://evil.example#.fcm.googleapis.com", "https://evil.example?.fcm.googleapis.com/", "https://[::1]/x", "https://fcm.googleapis.com%2eevil.example/x",
      "https://fcm.googleapis.com。evil.example/x", "https://notify.windows.com.evil.example/", "https://xn--fcm.googleapis.com/x"
    ].each { |url| assert_not PushNotifications.valid_endpoint?(url), "accepted #{url}" }
    assert PushNotifications.valid_endpoint?("https://fcm.googleapis.com/fcm/send/abc")
    assert PushNotifications.valid_endpoint?("https://updates.push.services.mozilla.com/wpush/v2/abc")
  end

  test "subscribing with malformed keys is refused with 422" do
    user = make_user("Key Checker")
    good = subscription_params
    with_push_env do
      bad_keys = [
        { p256dh: "a", auth: good[:keys][:auth] },
        { p256dh: good[:keys][:p256dh], auth: "b" },
        { p256dh: WebPush.encode64("\x04".b + ("\x01".b * 64)), auth: good[:keys][:auth] }, # right size, not on the curve
        { p256dh: WebPush.encode64("\x03".b + ("\x01".b * 64)), auth: good[:keys][:auth] }, # not uncompressed
        { p256dh: good[:keys][:p256dh], auth: WebPush.encode64(SecureRandom.random_bytes(20)) },
        { p256dh: "not base64 !!", auth: good[:keys][:auth] }
      ]
      bad_keys.each do |keys|
        post "/api/push/subscriptions", params: { endpoint: "#{ENDPOINT_BASE}#{SecureRandom.hex(6)}", keys: }, headers: auth(user), as: :json
        assert_response :unprocessable_content, keys.inspect
        assert_equal "INVALID_SUBSCRIPTION", response.parsed_body["code"]
      end
      assert_equal 0, user.push_subscriptions.count
      post "/api/push/subscriptions", params: good, headers: auth(user), as: :json
      assert_response :created
    end
  end

  test "a subscription with broken keys fails alone and the user's other devices still get the push" do
    user = make_user("Two Devices")
    user.create_profile!
    with_push_env do
      broken = make_subscription(user)
      broken.p256dh = "broken"
      broken.save!(validate: false)
      healthy = make_subscription(user)
      assert_equal :failed, PushNotifications.deliver(broken, { "title" => "t" }, category: "urgent").status

      calls = []
      stub = lambda do |**args|
        calls << args[:endpoint]
        raise ArgumentError, "invalid key" if args[:endpoint] == broken.endpoint
        true
      end
      WebPush.stub(:payload_send, stub) do
        PushDeliveryJob.perform_now(user.id, "urgent", { "title" => "t", "body" => "b", "url" => "/" })
      end
      assert_includes calls, healthy.endpoint
      assert_equal 1, broken.reload.failure_count
      assert_equal 0, healthy.reload.failure_count
      assert_not_nil healthy.last_success_at
    end
  end

  # --- Problem report blob cleanup ------------------------------------------------------------

  test "the screenshot blob is purged when the report cannot be saved" do
    user = make_user("Reporter")
    png = Tempfile.new(["shot", ".png"], binmode: true)
    png.write("\x89PNG\r\n\x1A\n".b + ("\0".b * 64))
    png.rewind
    original_new = ProblemReport.method(:new)
    invalid_new = ->(**attrs) { original_new.call(**attrs, description: "") }
    ProblemReport.stub(:new, invalid_new) do
      assert_no_difference -> { ActiveStorage::Blob.count } do
        post "/api/problem-reports", params: { description: "It broke.", screenshot: Rack::Test::UploadedFile.new(png.path, "image/png", true, original_filename: "s.png") }, headers: auth(user)
      end
    end
    assert_response :unprocessable_content
    assert_equal 0, ProblemReport.count
  end

  # --- Invite abuse ---------------------------------------------------------------------------

  test "an unverified inviter cannot send email invites" do
    owner = User.create!(name: "Unverified Owner", email: "unv-#{SecureRandom.hex(3)}@example.com", password: PASSWORD, role: "jobseeker", status: "active", profile_complete: true, email_verified: false)
    act = make_act(owner)
    assert_raises(ActInvites::Refused) { ActInvites.create!(act:, inviter: owner, kind: "email", role_name: "Bass", email: "someone@example.com") }
    error = assert_raises(ActInvites::Refused) { ActInvites.create!(act:, inviter: owner, kind: "email", role_name: "Bass", email: "someone@example.com") }
    assert_equal "EMAIL_NOT_VERIFIED", error.code
    assert_equal 0, ActInvite.count
  end

  test "one recipient can receive at most three invites a day across acts" do
    recipient = "popular@example.com"
    owners = Array.new(4) { |i| make_user("Owner #{i}") }
    3.times { |i| ActInvites.create!(act: make_act(owners[i], "Act #{i}"), inviter: owners[i], kind: "email", role_name: "Keys", email: recipient.upcase) }
    error = assert_raises(ActInvites::Refused) { ActInvites.create!(act: make_act(owners[3], "Act 3"), inviter: owners[3], kind: "email", role_name: "Keys", email: recipient) }
    assert_equal "RATE_LIMITED", error.code
    assert_equal :too_many_requests, error.status

    target = make_user("Target Musician")
    3.times { |i| ActInvites.create!(act: make_act(owners[i], "User Act #{i}"), inviter: owners[i], kind: "user", role_name: "Keys", invitee: target) }
    assert_raises(ActInvites::Refused) { ActInvites.create!(act: make_act(owners[3], "User Act 3"), inviter: owners[3], kind: "user", role_name: "Keys", invitee: target) }
    travel 25.hours do
      ActInvites.create!(act: make_act(owners[3], "Later Act"), inviter: owners[3], kind: "email", role_name: "Keys", email: recipient)
    end
  end

  test "invite accept: unverified same-email user, other users and plus-aliases cannot accept" do
    owner = make_user("Owner O")
    act = make_act(owner)
    invite, token = ActInvites.create!(act:, inviter: owner, kind: "email", role_name: "Bass", email: "Victim@Example.com")
    unverified = User.create!(name: "Mallory", email: "victim@example.com", password: PASSWORD, role: "jobseeker", status: "active", profile_complete: true, email_verified: false)
    other = make_user("Other")
    alias_user = User.create!(name: "Alias", email: "victim+x@example.com", password: PASSWORD, role: "jobseeker", status: "active", profile_complete: true, email_verified: true)
    [unverified, other, alias_user].each do |user|
      post "/api/act-invites/accept", params: { token: }, headers: auth(user), as: :json
      assert_response :forbidden
    end
    assert_equal 0, act.act_members.where(user_id: [unverified.id, other.id, alias_user.id]).count
    assert invite.reload.open?
  end
end
