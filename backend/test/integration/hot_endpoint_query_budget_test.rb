require "test_helper"
require_relative "../support/query_budget"

# Absolute SQL budgets for the hottest public and messaging endpoints (docs/PERFORMANCE.md,
# "Query plans at volume"). Each endpoint is measured on a small world and again after it grew,
# against the same budget, so the count neither creeps up nor grows with rows.
class HotEndpointQueryBudgetTest < ActionDispatch::IntegrationTest
  include QueryBudget

  PASSWORD = "StrongPass123!".freeze

  # path => budget (queries per request), measured 2026-10-03. The Stage fixtures include photo posts
  # and reshares of them, so the feed and tag budgets cover the reshared posts' media lookup too.
  # R3 search (measured 2026-10-03): the ranked lists (talent, acts) run one more statement, the
  # per-search limits (statement_timeout, trigram threshold) set at the start of Search::Runner.
  # R5 images (measured 2026-10-03): a page of profiles with photos resolves their variants (ImageSet.by_url)
  # in one more statement, as does a page of acts with covers; the talent detail runs two (the photo,
  # then the work samples' images and thumbnails) and an act detail one; the feed budget had the room.
  PUBLIC = {
    "/api/public/talent" => 11,
    "/api/public/talent?location=Mumbai&role=Drummer&genre=Rock" => 11,
    "/api/public/talent/{talent}" => 13,
    "/api/public/acts" => 6,
    "/api/public/acts/{act}" => 5,
    "/api/jobs" => 4,
    "/api/jobs/{job}" => 3,
    "/api/stage/tags/gig" => 5
  }.freeze
  SIGNED_IN = {
    "/api/conversations" => 6,
    # Opening a thread always clears its message notification (one UPDATE), see MessagesController#mark_read!.
    "/api/conversations/{conversation}/messages" => 7,
    "/api/notifications/unread" => 4,
    "/api/notifications" => 4,
    "/api/bookings" => 7,
    "/api/stage/feed" => 18
  }.freeze

  setup do
    @seq = 0
    @artist = person("Budget Artist", "jobseeker")
    @hirer = person("Budget Hirer", "employer", company_name: "Budget Hall")
    @token = sign_in(@artist)
    grow(2)
  end

  test "public list and show endpoints stay within their query budgets as rows grow" do
    PUBLIC.each { |path, budget| assert_budget(path, budget) }
    grow(10)
    PUBLIC.each { |path, budget| assert_budget(path, budget) }
  end

  test "inbox, thread, notification, bookings and feed endpoints stay within their query budgets as rows grow" do
    SIGNED_IN.each { |path, budget| assert_budget(path, budget, auth: true) }
    grow(10)
    SIGNED_IN.each { |path, budget| assert_budget(path, budget, auth: true) }
  end

  test "the helper fails a block that runs more queries than its budget" do
    two_lookups = -> { [@artist, @hirer].each { User.where(id: _1.id).to_a } }
    error = assert_raises(Minitest::Assertion) { assert_queries_at_most(1, "two lookups", &two_lookups) }
    assert_match(/two lookups: 2 queries, budget 1/, error.message)
    assert_equal 2, assert_queries_at_most(2, &two_lookups)
  end

  private

  def assert_budget(template, budget, auth: false)
    path = template.gsub("{talent}", @talent.id).gsub("{act}", @act.id).gsub("{job}", @job.id).gsub("{conversation}", @conversation.id)
    headers = auth ? { "Authorization" => "Bearer #{@token}" } : {}
    get(path, headers:) # warm-up: the first request loads schema and caches
    assert_queries_at_most(budget, path) { get(path, headers:) }
    assert_response :success
  end

  def person(name, role, **profile)
    @seq += 1
    user = User.create!(name:, email: "budget-#{@seq}-#{SecureRandom.hex(3)}@example.com", password: PASSWORD, role:, status: "active", profile_complete: true, email_verified: true)
    user.create_profile!({ headline: "Drummer for hire", location: "Mumbai, Maharashtra", roles: ["Drummer"], genres: ["Rock"], skills: ["Session recording"] }.merge(profile))
    user
  end

  def sign_in(user)
    raw = SecureRandom.urlsafe_base64(32)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 1.day.from_now)
    raw
  end

  # n more of everything the measured endpoints list.
  def grow(n)
    n.times do
      talent = person("Budget Drummer #{@seq}", "jobseeker")
      talent.profile.update!(verified: true)
      VerificationRequest.create!(user: talent, kind: "professional", status: "approved", checks: %w[identity], reviewed_at: Time.current)
      item = PortfolioItem.create!(user: talent, kind: "audio", title: "Rock drumming #{@seq}", url: "https://example.com/#{@seq}.mp3", visibility: "public")
      act = Act.create!(owner: talent, name: "Budget band #{@seq}", act_type: "band", status: "active", currency: "INR", fee_basis: "event", city: "Mumbai", genres: ["Rock"])
      act.act_members.create!(user: talent, display_name: talent.name, role_name: "Drummer", is_leader: true, member_status: "confirmed")
      job = Job.create!(employer: @hirer, title: "Drummer for a rock night #{@seq}", company: "Budget Hall", location: "Mumbai", kind: "Contract", opportunity_kind: "gig",
        workplace: "onsite", genre: "Rock", skills: ["Drums"], status: "published", published_at: Time.current,
        description: "A clearly documented paid engagement with rehearsals, written terms and on-site production support.")
      conversation = Conversation.create!(candidate: @artist, employer: talent == @artist ? @hirer : person("Budget Client #{@seq}", "employer"))
      3.times { conversation.messages.create!(sender: conversation.employer, body: "Are you free on the 12th?") }
      main = (@conversation ||= Conversation.create!(candidate: @artist, employer: @hirer))
      2.times { main.messages.create!(sender: [@artist, @hirer].sample, body: "Rehearsal notes") }
      Notification.create!(user: @artist, kind: "system", title: "Budget #{@seq}")
      BookingRequest.create!(act:, requester: @artist, event_type: "wedding", city: "Mumbai", currency: "INR", status: "requested")
      Post.create!(author_type: "user", author_id: talent.id, created_by_user_id: talent.id, kind: "update", body: "Gig tonight #{@seq} #gig")
      Post.create!(author_type: "user", author_id: talent.id, created_by_user_id: talent.id, kind: "update", body: "Fans only #{@seq} #gig", visibility: "followers")
      Post.create!(author_type: "user", author_id: talent.id, created_by_user_id: talent.id, kind: "portfolio_share", shared_portfolio_item_id: item.id)
      Post.create!(author_type: "act", author_id: act.id, created_by_user_id: talent.id, kind: "update", body: "Our band #{@seq}")
      Post.create!(author_type: "user", author_id: @hirer.id, created_by_user_id: @hirer.id, kind: "job_share", shared_job_id: job.id)
      variants = { "width" => 1200, "height" => 800, "formats" => { "webp" => [320, 768], "avif" => [320, 768] } }
      upload = Upload.create!(user: talent, storage: "s3", key: "uploads/#{talent.id}/#{@seq}.jpg", filename: "gig.jpg", content_type: "image/jpeg",
        byte_size: 1000, status: "complete", public_url: "https://cdn.example.com/uploads/#{talent.id}/#{@seq}.jpg", variants:)
      # Profile photo, act cover and an image work sample with generated variants (R5): their ImageSet
      # payloads are resolved per page, so the budgets below include that lookup.
      Upload.create!(user: talent, storage: "s3", key: "uploads/#{talent.id}/face-#{@seq}.jpg", filename: "face.jpg", content_type: "image/jpeg",
        byte_size: 1000, status: "complete", public_url: "https://cdn.example.com/uploads/#{talent.id}/face-#{@seq}.jpg", variants:)
      talent.profile.update!(photo_url: "https://cdn.example.com/uploads/#{talent.id}/face-#{@seq}.jpg")
      act.update!(photo_url: "https://cdn.example.com/uploads/#{talent.id}/face-#{@seq}.jpg")
      PortfolioItem.new(user: talent, kind: "image", title: "Stage shot #{@seq}", url: upload.public_url, visibility: "public").save!(validate: false)
      photo = Post.create!(author_type: "user", author_id: talent.id, created_by_user_id: talent.id, kind: "update", body: "Photos #{@seq} #gig",
        media: [{ uploadId: upload.id, type: "image" }])
      Post.create!(author_type: "user", author_id: @hirer.id, created_by_user_id: @hirer.id, kind: "update", body: "Look at this #{@seq} #gig", reshared_post_id: photo.id)
      @talent ||= talent
      @act ||= act
      @job ||= job
    end
  end
end
