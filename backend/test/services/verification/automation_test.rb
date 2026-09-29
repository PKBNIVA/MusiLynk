require "test_helper"
require "minitest/mock"

class VerificationAutomationTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    LinkPreview.fetcher = ->(_uri) { [404, ""] }
    Rails.cache.clear
    @seq = 0
  end

  teardown { LinkPreview.fetcher = ->(uri) { LinkPreview.http_get(uri) } }

  # --- helpers ---

  def user(name = "Rahul Sharma", email: nil, role: "jobseeker", verified: false)
    @seq += 1
    User.create!(name:, email: email || "vu#{@seq}@example.com", password: "StrongPass123!", role:, status: "active").tap do |u|
      u.create_profile!(verified:)
    end
  end

  def request_for(user, url: "https://www.youtube.com/watch?v=abc123", kind: "professional")
    VerificationRequest.create!(user:, kind:, evidence_url: url)
  end

  def stub_oembed(title:, author:)
    LinkPreview.fetcher = ->(_uri) { [200, { title:, author_name: author }.to_json] }
  end

  def connect(user, provider, uid: SecureRandom.hex(4), **attrs)
    AuthConnection.create!(owner: user, provider:, provider_uid: uid, **attrs)
  end

  def breakdown_for(request) = Verification::Evidence.call(request).breakdown

  def part(breakdown, component, key) = breakdown.dig(component, "parts", key)

  def complete_fill(user)
    UrgentRequest.create!(requester: user(), title: "Drummer", role_name: "Drummer", city: "Mumbai", currency: "INR", status: "filled",
      start_at: 2.days.from_now, filled_by: user)
  end

  def complete_booking(user)
    act = Act.create!(owner: user, name: "#{user.name} Band #{SecureRandom.hex(2)}", act_type: "band", status: "active", currency: "INR", fee_basis: "event", city: "Pune")
    BookingRequest.create!(act:, requester: user(), event_type: "wedding", city: "Pune", currency: "INR", status: "completed")
  end

  # --- identity ---

  test "identity: phone 15, verified Google 15, name match 10, capped at 30" do
    u = user("Rahul Sharma")
    b = breakdown_for(request_for(u))
    assert_equal 0, b["identity"]["score"]

    u.update!(phone_verified_at: Time.current)
    connect(u, "google", email_verified: true, display_name: "Rahul Sharma")
    b = breakdown_for(request_for(u))
    assert_equal 15, part(b, "identity", "phone")
    assert_equal 15, part(b, "identity", "google")
    assert_equal 10, part(b, "identity", "name")
    assert_equal 30, b["identity"]["score"], "40 raw points are capped at the component max"
  end

  test "identity: an unverified Google email earns nothing and first-name-only needs 5+ letters" do
    u = user("Rahul Sharma")
    connect(u, "google", email_verified: false, display_name: "Rahul S")
    b = breakdown_for(request_for(u))
    assert_equal 0, part(b, "identity", "google")
    assert_equal 10, part(b, "identity", "name"), "first name of 5 letters is enough alone"

    short = user("Raj Kumar")
    connect(short, "youtube", display_name: "Raj Drums")
    assert_equal 0, part(breakdown_for(request_for(short)), "identity", "name"), "3-letter first name alone does not match"
    connect(short, "instagram", display_name: "Raj Kumar Official")
    assert_equal 10, part(breakdown_for(request_for(short)), "identity", "name"), "first + last matches"
  end

  # --- proven links ---

  test "links: YouTube channel, Google-owned channel or Instagram business with 3+ media earn 20" do
    yt = user
    connect(yt, "youtube", raw: { "channel_id" => "UC123" })
    assert_equal 20, part(breakdown_for(request_for(yt)), "links", "proven_channel")

    google = user
    connect(google, "google", email_verified: true, raw: { "youtube_channel_id" => "UC9" })
    assert_equal 20, part(breakdown_for(request_for(google)), "links", "proven_channel")

    ig = user
    connect(ig, "instagram", raw: { "account_type" => "BUSINESS", "media_count" => 3 })
    assert_equal 20, part(breakdown_for(request_for(ig)), "links", "proven_channel")

    few = user
    connect(few, "instagram", raw: { "account_type" => "BUSINESS", "media_count" => 2 })
    assert_equal 0, part(breakdown_for(request_for(few)), "links", "proven_channel")

    personal = user
    connect(personal, "instagram", raw: { "account_type" => "PERSONAL", "media_count" => 40 })
    assert_equal 0, part(breakdown_for(request_for(personal)), "links", "proven_channel")

    none = user
    connect(none, "youtube")
    assert_equal 0, part(breakdown_for(request_for(none)), "links", "proven_channel"), "no raw data means 0"
  end

  test "links: two portfolio items on distinct providers earn 10" do
    u = user
    PortfolioItem.create!(user: u, kind: "video", title: "Live set", url: "https://www.youtube.com/watch?v=one")
    assert_equal 0, part(breakdown_for(request_for(u)), "links", "portfolio_providers")
    PortfolioItem.create!(user: u, kind: "audio", title: "Single", url: "https://soundcloud.com/rahul/single")
    assert_equal 10, part(breakdown_for(request_for(u)), "links", "portfolio_providers")

    same = user
    2.times { |i| PortfolioItem.create!(user: same, kind: "video", title: "Clip #{i}", url: "https://www.youtube.com/watch?v=s#{i}") }
    assert_equal 0, part(breakdown_for(request_for(same)), "links", "portfolio_providers")
  end

  # --- signal consistency ---

  test "signals: evidence title/author with a name token earns 8, role keywords earn 6, unique links earn 6" do
    stub_oembed(title: "Live drum solo", author: "Rahul Drums")
    u = user("Rahul Sharma")
    PortfolioItem.create!(user: u, kind: "video", title: "Drummer for hire", description: "Session work", url: "https://www.youtube.com/watch?v=mine1")
    b = breakdown_for(request_for(u, url: "https://www.youtube.com/watch?v=mine2"))
    assert_equal 8, part(b, "signals", "evidence_author")
    assert_equal 6, part(b, "signals", "role_keywords")
    assert_equal 6, part(b, "signals", "unique_links")
    assert_equal 20, b["signals"]["score"]
  end

  test "signals: no name token, no keywords, no links at all scores nothing" do
    u = user("Rahul Sharma")
    b = breakdown_for(request_for(u, url: nil))
    assert_equal 0, b["signals"]["score"], "nothing to check is not a free +6"
  end

  test "signals: a link found in another user's portfolio raises duplicate_links and scores 0 for unique_links" do
    other = user("Other Person")
    PortfolioItem.create!(user: other, kind: "video", title: "Not yours", url: "https://youtu.be/dupe1")
    u = user
    result = Verification::Evidence.call(request_for(u, url: "https://www.youtube.com/watch?v=x"))
    assert_not_includes result.flags, "duplicate_links"

    PortfolioItem.create!(user: other, kind: "video", title: "Same", url: "https://www.youtube.com/watch?v=x&t=10s")
    result = Verification::Evidence.call(request_for(u, url: "https://youtube.com/watch?v=x"))
    assert_includes result.flags, "duplicate_links"
    assert_equal 0, part(result.breakdown, "signals", "unique_links")

    PortfolioItem.create!(user: u, kind: "audio", title: "Mine", url: "https://soundcloud.com/other-person/track/")
    PortfolioItem.create!(user: other, kind: "audio", title: "Theirs", url: "https://www.soundcloud.com/other-person/track")
    assert_includes Verification::Evidence.call(request_for(u, url: nil)).flags, "duplicate_links"
  end

  # --- community ---

  test "community: vouch from a verified musician 10, completed work 10 (capped), review 5, component capped at 20" do
    u = user
    voucher = user("Priya S", verified: true)
    Vouch.create!(voucher:, vouchee_email: u.email, vouchee: u, status: "joined")
    b = breakdown_for(request_for(u))
    assert_equal 10, part(b, "community", "vouch")

    unverified = user("Unverified Friend")
    other = user
    Vouch.insert!({ id: SecureRandom.uuid, voucher_id: unverified.id, vouchee_email: other.email, vouchee_id: other.id, status: "joined", token: SecureRandom.hex(8) })
    assert_equal 0, part(breakdown_for(request_for(other)), "community", "vouch"), "voucher must be verified"

    invited = user
    Vouch.insert!({ id: SecureRandom.uuid, voucher_id: voucher.id, vouchee_email: invited.email, vouchee_id: invited.id, status: "invited", token: SecureRandom.hex(8) })
    assert_equal 0, part(breakdown_for(request_for(invited)), "community", "vouch"), "only joined/verified vouches count"

    3.times { complete_fill(u) }
    complete_booking(u)
    Review.create!(author: user, employer: u, rating: 5, body: "Great", status: "published")
    b = breakdown_for(request_for(u))
    assert_equal 10, part(b, "community", "completed"), "capped at 10 however many"
    assert_equal 5, part(b, "community", "review")
    assert_equal 20, b["community"]["score"]
  end

  test "community: pending reviews and unfilled or open requests do not count" do
    u = user
    UrgentRequest.create!(requester: user, title: "Open", role_name: "Drummer", city: "Pune", currency: "INR", status: "open", start_at: 2.days.from_now, filled_by: u)
    Review.create!(author: user, employer: u, rating: 4, body: "Pending", status: "pending")
    b = breakdown_for(request_for(u))
    assert_equal 0, b["community"]["score"]
  end

  # --- flags ---

  test "flags: disposable_email, velocity and recently_reported" do
    d = user(email: "someone@mailinator.com")
    assert_includes Verification::Evidence.call(request_for(d)).flags, "disposable_email"

    v = user
    3.times { request_for(v) }
    assert_includes Verification::Evidence.call(v.verification_requests.first).flags, "velocity"
    assert_not_includes Verification::Evidence.call(request_for(user)).flags, "velocity"

    r = user
    Report.create!(reporter: user, entity_type: "user", entity_id: r.id, reason: "spam", status: "resolved")
    assert_not_includes Verification::Evidence.call(request_for(r)).flags, "recently_reported"
    Report.create!(reporter: user, entity_type: "User", entity_id: r.id, reason: "spam", status: "open")
    assert_includes Verification::Evidence.call(request_for(r)).flags, "recently_reported"
  end

  test "evidence stores score, breakdown and flags on the request and totals at most 100" do
    u = user("Rahul Sharma")
    request = request_for(u)
    Verification::Evidence.call(request)
    request.reload
    assert_equal request.evidence_breakdown["total"], request.evidence_score
    assert_operator request.evidence_score, :<=, 100
    assert_equal %w[community identity links signals total facts].sort, request.evidence_breakdown.keys.sort
    assert_equal [], request.flags
  end

  test "a failing link preview is just no signal" do
    LinkPreview.fetcher = ->(_uri) { raise Timeout::Error }
    b = breakdown_for(request_for(user))
    assert_equal 0, part(b, "signals", "evidence_author")
    assert_equal 6, part(b, "signals", "unique_links")
  end

  # --- decision ---

  def strong_user(name: "Rahul Sharma")
    u = user(name)
    u.update!(phone_verified_at: Time.current)
    connect(u, "google", email_verified: true, display_name: name)
    connect(u, "youtube", raw: { "channel_id" => "UC1", "channel" => { "id" => "UC1", "title" => "Rahul Drums", "statistics" => { "videoCount" => "38" }, "publishedAt" => "2022-01-01T00:00:00Z" } })
    voucher = user("Priya S", verified: true)
    Vouch.create!(voucher:, vouchee_email: u.email, vouchee: u, status: "joined")
    PortfolioItem.create!(user: u, kind: "video", title: "Drummer live session", url: "https://www.youtube.com/watch?v=sess#{@seq}")
    PortfolioItem.create!(user: u, kind: "audio", title: "Single", url: "https://soundcloud.com/rahul/single#{@seq}")
    stub_oembed(title: "Live drums", author: name)
    u
  end

  test "strong evidence with proven identity is auto-approved exactly like the admin path" do
    u = strong_user
    request = request_for(u)
    Verification::Evaluate.stub(:sample?, false) { Verification::Evaluate.call(request) }
    request.reload
    assert_equal "approved", request.status
    assert_equal %w[identity work_links], request.checks
    assert_equal "auto_approved", request.auto_decision
    assert_not request.audit_sample
    assert_nil request.reviewed_by_id
    assert_predicate request.reviewed_at, :present?
    assert u.profile.reload.verified?
    assert_equal "verified", Vouch.find_by!(vouchee_id: u.id).status
    note = u.notifications.where(kind: "verification").order(:created_at).last
    assert_equal "Your verification request was approved.", note.body
    assert AuditLog.exists?(action: "verification.auto_approve", entity_id: request.id)
  end

  test "audit sampling marks the auto-approval for a human look and the approval stands" do
    request = request_for(strong_user)
    Verification::Evaluate.stub(:sample?, true) { Verification::Evaluate.call(request) }
    request.reload
    assert request.audit_sample
    assert_equal "approved", request.status
    assert_predicate request.summary, :present?
  end

  test "sample? follows the configured percent" do
    assert_not Verification::Evaluate.sample?(0)
    assert Verification::Evaluate.sample?(100.1)
    SecureRandom.stub(:random_number, 5.0) do
      assert Verification::Evaluate.sample?(10)
      assert_not Verification::Evaluate.sample?(5)
    end
  end

  test "a high score without proven identity is not auto-approved" do
    u = user("Rahul Sharma")
    connect(u, "youtube", display_name: "Rahul Sharma", raw: { "channel_id" => "UC1" })
    PortfolioItem.create!(user: u, kind: "video", title: "Drummer live", url: "https://www.youtube.com/watch?v=a1")
    PortfolioItem.create!(user: u, kind: "audio", title: "Track", url: "https://soundcloud.com/rahul/t")
    voucher = user("Priya S", verified: true)
    Vouch.create!(voucher:, vouchee_email: u.email, vouchee: u, status: "joined")
    3.times { complete_fill(u) }
    Review.create!(author: user, employer: u, rating: 5, body: "Good", status: "published")
    stub_oembed(title: "Drum cover", author: "Rahul Sharma")
    request = request_for(u)
    Verification::Evaluate.call(request)
    request.reload
    assert_operator request.evidence_score, :>=, 75
    assert_operator request.evidence_breakdown["identity"]["score"], :<, 15
    assert_equal "pending", request.status
    assert_nil request.auto_decision

    Verification::Config.stub(:auto_approve, Verification::Config.auto_approve.merge(require_identity: false)) do
      Verification::Evaluate.stub(:sample?, false) { Verification::Evaluate.call(request) }
    end
    assert_equal "approved", request.reload.status, "identity requirement is configurable"
  end

  test "any flag blocks auto-approval" do
    u = strong_user
    u.update!(email: "fast@mailinator.com")
    request = request_for(u)
    Verification::Evaluate.call(request)
    request.reload
    assert_equal "pending", request.status
    assert_includes request.flags, "disposable_email"
  end

  test "auto-approval can be switched off and never applies to organization requests" do
    u = strong_user
    request = request_for(u)
    Verification::Config.stub(:auto_approve, Verification::Config.auto_approve.merge(enabled: false)) { Verification::Evaluate.call(request) }
    assert_equal "pending", request.reload.status

    org = strong_user(name: "Studio Owner")
    org_request = request_for(org, kind: "organization")
    Verification::Evaluate.call(org_request)
    assert_equal "pending", org_request.reload.status
  end

  test "never auto-rejects: weak and empty requests stay pending" do
    u = user
    request = request_for(u, url: nil)
    Verification::Evaluate.call(request)
    assert_equal "pending", request.reload.status
    assert_equal "needs_more_proof", request.auto_decision
    assert_nil request.reviewed_at
  end

  test "below the summary threshold the musician gets one needs-more-proof notification listing what is missing" do
    u = user
    request = request_for(u, url: nil)
    Verification::Evaluate.call(request)
    note = u.notifications.where(kind: "verification").sole
    assert_equal "Add more proof to get verified faster", note.title
    %w[phone Google YouTube vouch].each { assert_includes note.body, _1 }

    Verification::Evaluate.call(request) # rescore: no second nudge
    assert_equal 1, u.notifications.where(kind: "verification").count
  end

  test "the needs-more-proof list only names what is still missing and an email is queued" do
    u = user
    u.update!(phone_verified_at: Time.current, email_verified_at: Time.current) if u.respond_to?(:email_verified_at)
    u.update!(phone_verified_at: Time.current)
    connect(u, "google", email_verified: true, display_name: "Someone")
    request = request_for(u, url: nil)
    Verification::Evaluate.call(request)
    body = u.notifications.where(kind: "verification").sole.body
    assert_not_includes body, "phone"
    assert_not_includes body, "Google"
    assert_includes body, "vouch"

    content = NotificationEmail.render("verification_more_proof", { "tips" => "a; b" }, u)
    assert_equal "Add more proof to get verified faster", content[:subject]
    assert_includes content[:text], "a; b"
  end

  test "email is queued for the needs-more-proof nudge" do
    u = user
    u.update!(email_verified: true)
    EmailDelivery.stub(:configured?, true) do
      assert_enqueued_jobs 1, only: NotificationEmailJob do
        Notifier.verification_needs_more_proof(u, ["verify your phone number"])
      end
    end
    args = enqueued_jobs.find { _1["job_class"] == "NotificationEmailJob" }["arguments"]
    assert_equal [u.id, "verification_more_proof"], args.first(2)
    Notifier.verification_needs_more_proof(u, [])
    assert_includes u.notifications.order(:created_at).last.body, "add links to your best work"
  end

  test "a request scoring above the threshold gets a summary and no more-proof nudge; a rising score clears needs_more_proof" do
    u = user("Rahul Sharma")
    request = request_for(u, url: nil)
    Verification::Evaluate.call(request)
    assert_equal "needs_more_proof", request.reload.auto_decision

    u.update!(phone_verified_at: Time.current)
    connect(u, "google", email_verified: true, display_name: "Rahul Sharma")
    connect(u, "youtube", raw: { "channel_id" => "UC5" })
    Verification::Evaluate.call(request)
    request.reload
    assert_operator request.evidence_score, :>=, 40
    assert_nil request.auto_decision
    assert_equal "pending", request.status
    assert_equal 3, request.summary.lines.size
  end

  test "non-pending requests are left alone" do
    request = request_for(user)
    request.update!(status: "rejected")
    Verification::Evaluate.call(request)
    assert_nil request.reload.evidence_score
  end

  # --- rescoring ---

  test "RescoreJob.for_user enqueues only for users with a pending request" do
    u = user
    assert_no_enqueued_jobs { Verification::RescoreJob.for_user(u.id) }
    assert_no_enqueued_jobs { Verification::RescoreJob.for_user(nil) }
    request = request_for(u)
    assert_enqueued_with(job: Verification::RescoreJob, args: [request.id]) { Verification::RescoreJob.for_user(u.id) }
    request.update!(status: "approved")
    assert_no_enqueued_jobs { Verification::RescoreJob.for_user(u.id) }
  end

  test "the job re-scores a pending request and skips a decided one" do
    u = user
    request = request_for(u, url: nil)
    Verification::RescoreJob.perform_now(request.id)
    assert_equal 0, request.reload.evidence_score
    request.update!(status: "rejected", evidence_score: 5)
    Verification::RescoreJob.perform_now(request.id)
    assert_equal 5, request.reload.evidence_score
    assert_nothing_raised { Verification::RescoreJob.perform_now("missing") }
  end

  test "rescore is triggered by connections, vouches, fills, bookings, reviews and phone verification" do
    u = user
    request_for(u)
    clear_enqueued_jobs
    assert_enqueued_jobs(1, only: Verification::RescoreJob) { connect(u, "google", email_verified: true) }
    clear_enqueued_jobs
    voucher = user("Voucher", verified: true)
    vouch = Vouch.create!(voucher:, vouchee_email: u.email)
    assert_no_enqueued_jobs(only: Verification::RescoreJob) { }
    assert_enqueued_jobs(1, only: Verification::RescoreJob) { vouch.update!(vouchee: u, status: "joined") }
    clear_enqueued_jobs
    assert_enqueued_jobs(1, only: Verification::RescoreJob) { complete_fill(u) }
    clear_enqueued_jobs
    assert_enqueued_jobs(1, only: Verification::RescoreJob) { complete_booking(u) }
    clear_enqueued_jobs
    assert_enqueued_jobs(1, only: Verification::RescoreJob) { Review.create!(author: user, employer: u, rating: 5, body: "Nice", status: "published") }
    clear_enqueued_jobs
    assert_enqueued_jobs(1, only: Verification::RescoreJob) { u.update!(phone_verified_at: Time.current) }
  end

  test "a scoring enqueue failure never breaks the write" do
    Verification::RescoreJob.stub(:perform_later, ->(*) { raise "queue down" }) do
      u = user
      request_for(u)
      assert_nothing_raised { connect(u, "google") }
    end
  end

  # --- tiers ---

  test "tier: verified requires the profile badge, verified_pro also needs completed work and a review" do
    assert_nil Verification::Tier.for(user)
    u = user(verified: true)
    assert_equal "verified", Verification::Tier.for(u)
    2.times { complete_fill(u) }
    complete_booking(u)
    assert_equal "verified", Verification::Tier.for(u), "3 completed but no review"
    Review.create!(author: user, employer: u, rating: 5, body: "Great", status: "published")
    assert_equal "verified_pro", Verification::Tier.for(u)
    ids = Verification::Tier.pro_user_ids_sql
    assert_equal [u.id], User.where("users.id IN (#{ids})").pluck(:id)
  end

  test "tier: two completed jobs are not enough and pending reviews do not count" do
    u = user(verified: true)
    2.times { complete_fill(u) }
    Review.create!(author: user, employer: u, rating: 5, body: "Great", status: "published")
    assert_equal "verified", Verification::Tier.for(u)
    complete_fill(u)
    Review.where(employer_id: u.id).update_all(status: "pending")
    assert_equal "verified", Verification::Tier.for(u)
    assert_empty User.where("users.id IN (#{Verification::Tier.pro_user_ids_sql})")
  end

  # --- AI summary ---

  class FakeClient
    attr_reader :bodies
    def initialize(text) = (@text = text; @bodies = [])
    def post(_url, headers:, body:, open_timeout:, read_timeout:)
      @bodies << JSON.parse(body)
      [200, { content: [{ type: "text", text: @text }], usage: { input_tokens: 400, output_tokens: 40 } }.to_json]
    end
  end

  def scored_request
    request = request_for(strong_user)
    Verification::Evidence.call(request)
    request
  end

  test "the summary falls back to a three-line template when AI is off" do
    request = scored_request
    assert_not AiAssist.enabled?
    text = Verification::Summarizer.call(request)
    assert_equal 3, text.lines.size
    assert_includes text, "Score #{request.evidence_score}/100"
    assert_includes text, "phone verified"
    assert_includes text, "youtube channel 'Rahul Drums'"
    assert_includes text, "1 vouch from verified Priya S"
    assert_equal text, request.reload.summary
  end

  test "the AI summary is one Haiku call with facts only, three lines max, and is recorded against the task budget" do
    request = scored_request
    client = FakeClient.new("Name matches YouTube 'Rahul Drums'.\nOne vouch.\nThird.\nFourth is dropped.")
    with_ai do
      Verification::Summarizer.new(request, client:).then { _1.call }
    end
    body = client.bodies.sole
    assert_equal AiAssist::DEFAULT_MODEL, body["model"]
    assert_includes body["system"], "Use only the facts provided. Do not infer or invent."
    assert_operator body["messages"].first["content"].length, :<=, 2_100
    assert_equal 3, request.reload.summary.lines.size
    row = AiCreditLedger.find_by!(task: "verification_summary")
    assert_equal 0, row.delta
    assert_operator row.cost_inr, :>, 0
    assert_operator AiSpendGuard.task_spend_inr("verification_summary"), :>, 0
  end

  test "the facts sent to the model are plain text capped at 2000 characters" do
    request = scored_request
    request.evidence_breakdown["facts"]["evidence"] = { "provider" => "youtube", "title" => "x" * 5_000 }
    assert_operator Verification::Summarizer.new(request).facts_text.length, :<=, 2_000
  end

  test "over the task budget the deterministic template is used and no call is made" do
    request = scored_request
    AiCreditLedger.create!(account_type: "user", account_id: request.user_id, delta: 0, reason: "usage", task: "verification_summary",
      period: AiCredits.current_period, cost_inr: 300)
    client = FakeClient.new("AI text")
    with_ai { Verification::Summarizer.new(request, client:).call }
    assert_empty client.bodies
    assert_includes request.reload.summary, "Score "
    assert_raises(AiSpendGuard::Paused) { AiSpendGuard.check_task!("verification_summary") }
  end

  test "the global hard budget also stops summaries" do
    request = scored_request
    AiCreditLedger.create!(account_type: "user", account_id: request.user_id, delta: 0, reason: "usage", task: "profile_headline",
      period: AiCredits.current_period, cost_inr: 1_500)
    client = FakeClient.new("AI text")
    with_ai { Verification::Summarizer.new(request, client:).call }
    assert_empty client.bodies
  end

  test "an upstream AI error falls back to the template" do
    request = scored_request
    failing = Object.new
    def failing.post(*, **) = [500, "{}"]
    with_ai { Verification::Summarizer.new(request, client: failing).call }
    assert_includes request.reload.summary, "Score "
  end

  test "verification_summary is registered, admin-only and allowed in launch mode with its own budget line" do
    assert AiAssist::Tasks::REGISTRY.key?("verification_summary")
    assert_not AiAssist.known_task?("verification_summary"), "not reachable through /api/ai/suggest"
    assert_not_includes AiAssist.tasks, "verification_summary"
    assert AiPricing.task_enabled?("verification_summary")
    assert_equal 300, AiPricing.verification_summary_budget_inr
    assert_equal %w[profile_headline profile_bio job_description job_screening_questions].sort, AiPricing.enabled_tasks.sort
    assert_operator AiAssist.max_tokens_for("verification_summary"), :<=, 160
  end

  def with_ai
    previous = ENV["ANTHROPIC_API_KEY"], ENV["AI_ASSIST_ENABLED"]
    ENV["ANTHROPIC_API_KEY"] = "test-key"
    ENV["AI_ASSIST_ENABLED"] = "true"
    yield
  ensure
    ENV["ANTHROPIC_API_KEY"], ENV["AI_ASSIST_ENABLED"] = previous
  end
end
