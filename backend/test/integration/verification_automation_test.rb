require "test_helper"
require "minitest/mock"

class VerificationAutomationIntegrationTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup { Rails.cache.clear }

  test "creating a request enqueues a rescore, and a 4th request in 30 days is refused with 422" do
    artist = create_user("Rate Artist", "rate-artist@example.com")
    token = session_for(artist)
    3.times do |i|
      assert_enqueued_with(job: Verification::RescoreJob) do
        post "/api/verification-requests", params: { kind: "professional", evidenceUrl: "https://example.com/#{i}" }, headers: auth(token), as: :json
      end
      assert_response :created
    end
    post "/api/verification-requests", params: { kind: "professional", evidenceUrl: "https://example.com/4" }, headers: auth(token), as: :json
    assert_response :unprocessable_content
    assert_equal "VERIFICATION_RATE_LIMITED", response.parsed_body.fetch("code")
    assert_match(/at most 3 verification requests in 30 days/, response.parsed_body.fetch("error"))
    assert_equal 3, artist.verification_requests.count

    artist.verification_requests.update_all(created_at: 31.days.ago)
    post "/api/verification-requests", params: { kind: "professional" }, headers: auth(token), as: :json
    assert_response :created
  end

  test "the queue is sorted vouched first, then by score, and exposes score, flags, summary and audit sample" do
    admin = create_user("Q Admin", "q-admin@example.com", "admin")
    low = VerificationRequest.create!(user: create_user("Low", "low@example.com"), kind: "professional", evidence_score: 20)
    high = VerificationRequest.create!(user: create_user("High", "high@example.com"), kind: "professional", evidence_score: 80, flags: ["velocity"],
      summary: "Line one.\nLine two.\nLine three.", audit_sample: true, auto_decision: "auto_approved", status: "approved")
    voucher = create_user("Vouch Er", "vouch-er@example.com", verified: true)
    vouched_user = create_user("Vouched", "vouched@example.com")
    vouched_user.update!(vouched_by_id: voucher.id)
    vouched = VerificationRequest.create!(user: vouched_user, kind: "professional", evidence_score: 5)

    get "/api/admin/verifications", headers: auth(session_for(admin))
    assert_response :success
    rows = response.parsed_body.fetch("requests")
    assert_equal [vouched.id, high.id, low.id], rows.map { _1["id"] }
    row = rows.find { _1["id"] == high.id }
    assert_equal 80, row["evidence_score"]
    assert_equal ["velocity"], row["flags"]
    assert_equal true, row["audit_sample"]
    assert_equal "auto_approved", row["auto_decision"]
    assert_equal "Line one.\nLine two.\nLine three.", row["summary"]
  end

  test "stats report the auto-approval rate and audit-sample count for 7 and 30 days" do
    admin = create_user("S Admin", "s-admin@example.com", "admin")
    make = ->(email, age, **attrs) { VerificationRequest.create!(user: create_user(email, "#{email.delete(' ').downcase}@example.com"), kind: "professional", created_at: age.days.ago, **attrs) }
    make.call("A One", 1, auto_decision: "auto_approved", audit_sample: true, status: "approved")
    make.call("A Two", 2)
    make.call("A Three", 3)
    make.call("A Four", 4, auto_decision: "needs_more_proof")
    make.call("A Old", 20, auto_decision: "auto_approved", status: "approved")
    make.call("A Older", 20)

    get "/api/admin/verifications/stats", headers: auth(session_for(admin))
    assert_response :success
    assert_equal({ "total" => 4, "autoApproved" => 1, "autoApprovalRate" => 25.0, "auditSample" => 1 }, response.parsed_body["days7"])
    assert_equal({ "total" => 6, "autoApproved" => 2, "autoApprovalRate" => 33.3, "auditSample" => 1 }, response.parsed_body["days30"])
  end

  test "stats with no requests is zero, and only admins can read it" do
    admin = create_user("Z Admin", "z-admin@example.com", "admin")
    get "/api/admin/verifications/stats", headers: auth(session_for(admin))
    assert_equal 0, response.parsed_body.dig("days7", "autoApprovalRate")
    get "/api/admin/verifications/stats", headers: auth(session_for(create_user("Nope", "nope@example.com")))
    assert_response :forbidden
    get "/api/admin/verifications/stats"
    assert_response :unauthorized
  end

  test "admin approve marks the reviewer, checks, badge and notification through the shared decision path" do
    admin = create_user("A Admin", "a-admin@example.com", "admin")
    artist = create_user("Approve Me", "approve-me@example.com")
    request = VerificationRequest.create!(user: artist, kind: "professional")
    patch "/api/admin/verifications/#{request.id}", params: { status: "approved", checks: %w[identity credits] }, headers: auth(session_for(admin)), as: :json
    assert_response :success
    request.reload
    assert_equal "approved", request.status
    assert_equal admin.id, request.reviewed_by_id
    assert_equal %w[identity credits], request.checks
    assert artist.profile.reload.verified?
    assert_equal "Your verification request was approved.", artist.notifications.last.body
    assert AuditLog.exists?(action: "admin.verification.status", entity_id: request.id)
  end

  test "rejecting with a reason shows the reason to the account owner" do
    admin = create_user("J Admin", "j-admin@example.com", "admin")
    artist = create_user("Reject Me", "reject-me@example.com")
    request = VerificationRequest.create!(user: artist, kind: "professional")
    patch "/api/admin/verifications/#{request.id}", params: { status: "rejected", reason: "  Link is private.  " }, headers: auth(session_for(admin)), as: :json
    assert_response :success
    assert_equal "rejected", request.reload.status
    assert_equal "Your verification request was rejected. Reason: Link is private.", artist.notifications.last.body
    patch "/api/admin/verifications/#{request.id}", params: { status: "rejected" }, headers: auth(session_for(admin)), as: :json
    assert_equal "Your verification request was rejected.", artist.notifications.order(:created_at).last.body
  end

  test "revoking an auto-approved request rejects it, clears the badge and notifies" do
    admin = create_user("R Admin", "r-admin@example.com", "admin")
    artist = create_user("Revoke Me", "revoke-me@example.com", verified: true)
    request = VerificationRequest.create!(user: artist, kind: "professional", status: "approved", checks: %w[identity work_links], auto_decision: "auto_approved", audit_sample: true)

    post "/api/admin/verifications/#{request.id}/revoke", headers: auth(session_for(admin)), as: :json
    assert_response :success
    request.reload
    assert_equal "rejected", request.status
    assert_equal admin.id, request.reviewed_by_id
    assert_not artist.profile.reload.verified?
    assert_match(/revoked/, artist.notifications.last.body)
    assert AuditLog.exists?(action: "admin.verification.revoke", entity_id: request.id)

    post "/api/admin/verifications/#{request.id}/revoke", headers: auth(session_for(admin)), as: :json
    assert_response :unprocessable_content
    assert_equal "NOT_APPROVED", response.parsed_body.fetch("code")
  end

  test "revoking keeps the badge when another approved request exists" do
    admin = create_user("K Admin", "k-admin@example.com", "admin")
    artist = create_user("Keep Badge", "keep-badge@example.com", verified: true)
    VerificationRequest.create!(user: artist, kind: "professional", status: "approved", checks: ["identity"])
    auto = VerificationRequest.create!(user: artist, kind: "professional", status: "approved", checks: ["identity"], auto_decision: "auto_approved")
    post "/api/admin/verifications/#{auto.id}/revoke", headers: auth(session_for(admin)), as: :json
    assert_response :success
    assert artist.profile.reload.verified?
  end

  test "revoke is admin-only and 404s for a missing request" do
    artist = create_user("Not Admin", "not-admin@example.com", verified: true)
    request = VerificationRequest.create!(user: artist, kind: "professional", status: "approved", checks: ["identity"])
    post "/api/admin/verifications/#{request.id}/revoke", headers: auth(session_for(artist)), as: :json
    assert_response :forbidden
    assert_equal "approved", request.reload.status
    post "/api/admin/verifications/#{request.id}/revoke", as: :json
    assert_response :unauthorized
    post "/api/admin/verifications/missing/revoke", headers: auth(session_for(create_user("Adm", "adm@example.com", "admin"))), as: :json
    assert_response :not_found
  end

  test "a created request that scores strongly ends up auto-approved once the job runs" do
    artist = create_user("Rahul Sharma", "rahul-strong@example.com")
    artist.update!(phone_verified_at: Time.current)
    AuthConnection.create!(owner: artist, provider: "google", provider_uid: "g1", email_verified: true, display_name: "Rahul Sharma")
    AuthConnection.create!(owner: artist, provider: "youtube", provider_uid: "y1", raw: { "channel_id" => "UC1" })
    PortfolioItem.create!(user: artist, kind: "video", title: "Drummer live", url: "https://www.youtube.com/watch?v=strong1")
    PortfolioItem.create!(user: artist, kind: "audio", title: "Single", url: "https://soundcloud.com/rahul/strong1")
    LinkPreview.fetcher = ->(_uri) { [200, { title: "Drum solo", author_name: "Rahul Sharma" }.to_json] }
    voucher = create_user("Priya S", "priya-s@example.com", verified: true)
    Vouch.create!(voucher:, vouchee_email: artist.email, vouchee: artist, status: "joined")

    perform_enqueued_jobs(only: Verification::RescoreJob) do
      Verification::Evaluate.stub(:sample?, false) do
        post "/api/verification-requests", params: { kind: "professional", evidenceUrl: "https://www.youtube.com/watch?v=strong1x" }, headers: auth(session_for(artist)), as: :json
      end
    end
    assert_response :created
    request = artist.verification_requests.sole
    assert_equal "approved", request.status
    assert_equal "auto_approved", request.auto_decision
    assert artist.profile.reload.verified?
  ensure
    LinkPreview.fetcher = ->(uri) { LinkPreview.http_get(uri) }
  end

  test "public talent JSON exposes verificationTier and the directory filters to Verified Pro" do
    pro = create_user("Pro Artist", "pro-artist@example.com", verified: true)
    plain = create_user("Plain Verified", "plain-verified@example.com", verified: true)
    [pro, plain].each { _1.update!(profile_complete: true) }
    3.times do
      UrgentRequest.create!(requester: create_user("Hirer #{SecureRandom.hex(2)}", "h#{SecureRandom.hex(3)}@example.com"), title: "Drummer", role_name: "Drummer",
        city: "Pune", currency: "INR", status: "filled", start_at: 2.days.from_now, filled_by: pro)
    end
    Review.create!(author: create_user("Rev", "rev@example.com"), employer: pro, rating: 5, body: "Great", status: "published")

    get "/api/public/talent/#{pro.id}"
    assert_equal "verified_pro", response.parsed_body.dig("professional", "verificationTier")
    get "/api/public/talent/#{plain.id}"
    assert_equal "verified", response.parsed_body.dig("professional", "verificationTier")

    get "/api/public/talent", params: { verified: "pro" }
    assert_response :success
    assert_equal [pro.id], response.parsed_body.fetch("talent").map { _1["id"] }
    get "/api/public/talent", params: { verified: "true" }
    assert_equal [pro.id, plain.id].sort, response.parsed_body.fetch("talent").map { _1["id"] }.sort
  end

  test "an unverified professional has a null tier and verification_summary is not reachable through /api/ai/suggest" do
    plain = create_user("Nobody", "nobody@example.com")
    plain.update!(profile_complete: true)
    get "/api/public/talent/#{plain.id}"
    assert_nil response.parsed_body.dig("professional", "verificationTier")

    post "/api/ai/suggest", params: { task: "verification_summary", context: { facts: "x" } }, headers: auth(session_for(create_user("Ai Admin", "ai-admin@example.com", "admin"))), as: :json
    assert_includes [403, 422, 503], response.status
    assert_not_equal 200, response.status
  end

  private

  def create_user(name, email, role = "jobseeker", verified: false)
    User.create!(name:, email:, password: "StrongPass123!", role:, status: "active").tap { _1.create_profile!(verified:) }
  end

  def auth(token) = { "Authorization" => "Bearer #{token}" }

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    raw
  end
end
