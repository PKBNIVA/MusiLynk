require "test_helper"

# B7 hirer flows: urgent responses lead to a conversation and can be accepted, urgent lists are
# scoped and paged, one thread per hirer-musician pair, musician-level quotes, the booking
# enquiry limit and change-request message, the verificationPending flag on /me, and the
# double-submit guard on posting an opportunity.
class HirerFlowsTest < ActionDispatch::IntegrationTest
  setup do
    @hirer = create_user("Hira Hirer", "hf-hirer@example.com", "employer")
    @drummer = create_user("Dev Drummer", "hf-drummer@example.com", "jobseeker")
    @drummer.create_profile!(headline: "Drummer", location: "Mumbai", roles: ["Drummer"], verified: true)
    @singer = create_user("Sia Singer", "hf-singer@example.com", "jobseeker")
    @singer.create_profile!(headline: "Singer", location: "Pune", roles: ["Singer"])
  end

  def urgent_request(requester: @hirer, role: "Drummer", city: "Mumbai", start_at: 1.day.from_now, **extra)
    UrgentRequest.create!(requester:, title: "#{role} needed in #{city}", role_name: role, city:, start_at:, currency: "INR", status: "open", **extra)
  end

  # ---- J-03: responding and accepting ----

  test "responding opens the conversation with the note as its first message, once" do
    item = urgent_request
    post "/api/urgent-requests/#{item.id}/respond", params: { message: "Free from 6 pm" }, headers: auth(@drummer), as: :json
    assert_response :created
    conversation = Conversation.find(response.parsed_body.fetch("conversationId"))
    assert_equal [@drummer.id, @hirer.id], [conversation.candidate_id, conversation.employer_id]
    assert_equal ["Free from 6 pm"], conversation.messages.pluck(:body)

    # Updating the response reuses the thread and does not repeat the note.
    post "/api/urgent-requests/#{item.id}/respond", params: { message: "Free from 7 pm" }, headers: auth(@drummer), as: :json
    assert_equal conversation.id, response.parsed_body.fetch("conversationId")
    assert_equal 1, conversation.messages.count
  end

  test "a response without a note still opens an empty conversation, unless either side blocked the other" do
    item = urgent_request
    post "/api/urgent-requests/#{item.id}/respond", params: {}, headers: auth(@drummer), as: :json
    assert_response :created
    assert response.parsed_body["conversationId"].present?

    other = urgent_request(role: "Singer")
    UserBlock.create!(blocker: @hirer, blocked: @singer)
    post "/api/urgent-requests/#{other.id}/respond", params: { message: "Hi" }, headers: auth(@singer), as: :json
    assert_response :created
    assert_nil response.parsed_body["conversationId"]
  end

  test "accept fills the request with the chosen responder, notifies both and posts nothing public" do
    item = urgent_request
    post "/api/urgent-requests/#{item.id}/respond", params: { message: "Available" }, headers: auth(@drummer), as: :json

    assert_no_difference "Post.count" do
      post "/api/urgent-requests/#{item.id}/accept", params: { userId: @drummer.id }, headers: auth(@hirer), as: :json
    end
    assert_response :success
    body = response.parsed_body
    assert_equal "filled", item.reload.status
    assert_equal @drummer.id, item.filled_by_id
    assert_equal "accepted", UrgentRequestResponse.find_by(urgent_request_id: item.id, user_id: @drummer.id).status
    assert body["conversationId"].present?
    assert_equal "/messages?c=#{body['conversationId']}", Notification.find_by!(user: @drummer, kind: "urgent_accepted").link
    assert Notification.exists?(user: @hirer, kind: "urgent_accepted")
  end

  test "accept is for the requester, for people who responded, and only while open" do
    item = urgent_request
    post "/api/urgent-requests/#{item.id}/respond", params: { message: "Available" }, headers: auth(@drummer), as: :json

    post "/api/urgent-requests/#{item.id}/accept", params: { userId: @drummer.id }, headers: auth(@singer), as: :json
    assert_response :not_found

    post "/api/urgent-requests/#{item.id}/accept", params: { userId: @singer.id }, headers: auth(@hirer), as: :json
    assert_response :unprocessable_content

    post "/api/urgent-requests/#{item.id}/accept", params: { userId: @drummer.id }, headers: auth(@hirer), as: :json
    assert_response :success
    post "/api/urgent-requests/#{item.id}/accept", params: { userId: @drummer.id }, headers: auth(@hirer), as: :json
    assert_response :conflict
  end

  # ---- J-11: scoped, paged urgent lists ----

  test "a musician's default list is the requests that fit their role and city, matched by whole words" do
    fits = urgent_request(role: "Drummer", city: "Mumbai")
    urgent_request(role: "Singer", city: "Mumbai")
    urgent_request(role: "Drummer", city: "Delhi")
    urgent_request(role: "Dholak", city: "Mumbai")
    @drummer.profile.update!(roles: ["Dhol"])
    urgent_request(role: "Dhol", city: "Mumbai")

    get "/api/urgent-requests", headers: auth(@drummer)
    assert_response :success
    body = response.parsed_body
    assert_equal "matches", body["scope"]
    assert_equal ["Dhol"], body["requests"].map { _1["role_name"] }
    refute_includes body["requests"].map { _1["id"] }, fits.id
  end

  test "browse lists every open request from others, 20 at a time, and never the caller's own" do
    25.times { |i| urgent_request(role: "Drummer", city: "Mumbai", start_at: (i + 1).hours.from_now) }
    own = urgent_request(requester: @drummer, role: "Bassist")

    get "/api/urgent-requests", params: { scope: "browse" }, headers: auth(@drummer)
    body = response.parsed_body
    assert_equal [20, 25, true, 1], [body["requests"].size, body["total"], body["hasMore"], body["page"]]
    refute_includes body["requests"].map { _1["id"] }, own.id

    get "/api/urgent-requests", params: { scope: "browse", page: 2 }, headers: auth(@drummer)
    body = response.parsed_body
    assert_equal [5, false], [body["requests"].size, body["hasMore"]]
  end

  test "an absurd page number answers with an empty page, never an error" do
    urgent_request
    [0, -4, 10**30, "abc"].each do |page|
      get "/api/urgent-requests", params: { scope: "browse", page: }, headers: auth(@drummer)
      assert_response :success, "page=#{page}"
    end
    get "/api/urgent-requests", params: { scope: "browse", page: 10**30 }, headers: auth(@drummer)
    assert_equal [], response.parsed_body["requests"]
  end

  test "a hirer's default list is their own requests in any status" do
    mine = urgent_request
    filled = urgent_request(role: "Singer")
    filled.update!(status: "filled")
    urgent_request(requester: @singer)

    get "/api/urgent-requests", headers: auth(@hirer)
    body = response.parsed_body
    assert_equal "mine", body["scope"]
    assert_equal [mine.id, filled.id].sort, body["requests"].map { _1["id"] }.sort

    get "/api/urgent-requests", params: { scope: "nonsense" }, headers: auth(@hirer)
    assert_response :bad_request
  end

  # ---- J-19: one thread per pair ----

  test "opening a conversation again for the same pair reuses the thread and moves its opportunity context" do
    first = Job.create!(employer: @hirer, title: "Wedding drummer", description: "Two sets at a wedding in Mumbai, with gear provided on the night by the venue.", company: "Hira", location: "Mumbai", kind: "gig", genre: "Pop", status: "published")
    second = Job.create!(employer: @hirer, title: "Studio session", description: "A day of recording in Mumbai, tracking drums for an EP release this winter.", company: "Hira", location: "Mumbai", kind: "gig", genre: "Pop", status: "published")
    Application.create!(job: first, candidate: @drummer)
    Application.create!(job: second, candidate: @drummer)

    post "/api/conversations", params: { jobId: first.id, candidateId: @drummer.id }, headers: auth(@hirer), as: :json
    assert_response :created
    id = response.parsed_body.fetch("id")
    post "/api/conversations", params: { jobId: second.id, candidateId: @drummer.id }, headers: auth(@hirer), as: :json
    assert_equal id, response.parsed_body.fetch("id")
    assert_equal second.id, Conversation.find(id).job_id

    post "/api/conversations", params: { candidateId: @drummer.id }, headers: auth(@hirer), as: :json
    assert_equal id, response.parsed_body.fetch("id")
    assert_equal 1, Conversation.where(candidate: @drummer, employer: @hirer).count
  end

  test "a thread older than the rule, one per opportunity, still resolves to a single newest thread" do
    job = Job.create!(employer: @hirer, title: "Wedding drummer", description: "Two sets at a wedding in Mumbai, with gear provided on the night by the venue.", company: "Hira", location: "Mumbai", kind: "gig", genre: "Pop", status: "published")
    old = Conversation.create!(candidate: @drummer, employer: @hirer, job:, updated_at: 3.days.ago)
    newer = Conversation.create!(candidate: @drummer, employer: @hirer, updated_at: 1.day.ago)
    assert_equal newer, Conversation.open_between!(candidate: @drummer, employer: @hirer)
    assert_equal old, Conversation.open_between!(candidate: @drummer, employer: @hirer, job:)
  end

  test "compare says which professionals this hirer has shortlisted" do
    TalentShortlist.create!(employer: @hirer, candidate: @drummer)
    get "/api/candidates/compare/list", params: { ids: [@drummer.id, @singer.id].join(",") }, headers: auth(@hirer)
    assert_response :success
    flags = response.parsed_body.fetch("professionals").to_h { [_1["id"], _1["shortlisted"]] }
    assert_equal({ @drummer.id => true, @singer.id => false }, flags)
  end

  # ---- A-09: a quote asked of a musician ----

  test "an enquiry addressed to a musician who fronts no act goes to their solo act" do
    assert_difference "BookingRequest.count", 1 do
      post "/api/bookings", params: { musicianId: @drummer.id, eventType: "wedding", city: "Mumbai", eventDate: 2.months.from_now.to_date.iso8601 }, headers: auth(@hirer), as: :json
    end
    assert_response :created
    booking = BookingRequest.find(response.parsed_body.fetch("id"))
    assert_equal @drummer.id, booking.act.owner_id
    assert_equal ["solo", "inactive"], [booking.act.act_type, booking.act.status]
    assert Notification.exists?(user: @drummer, kind: "booking")

    # The hidden solo act is reused, and never shows up in the public acts list.
    post "/api/bookings", params: { musicianId: @drummer.id, eventType: "corporate", city: "Mumbai", eventDate: 3.months.from_now.to_date.iso8601 }, headers: auth(@hirer), as: :json
    assert_equal 1, @drummer.owned_acts.count
    get "/api/public/acts"
    refute_includes response.parsed_body.fetch("acts").map { _1["id"] }, booking.act_id
    get "/api/bookings", headers: auth(@drummer)
    assert_equal 2, response.parsed_body.fetch("bookings").size
  end

  test "a musician enquiry cannot target yourself or someone who is not listed" do
    post "/api/bookings", params: { musicianId: @hirer.id, eventType: "wedding", city: "Mumbai", eventDate: 2.months.from_now.to_date.iso8601 }, headers: auth(@hirer), as: :json
    assert_response :not_found
    @drummer.update!(profile_complete: false)
    post "/api/bookings", params: { musicianId: @drummer.id, eventType: "wedding", city: "Mumbai", eventDate: 2.months.from_now.to_date.iso8601 }, headers: auth(@hirer), as: :json
    assert_response :not_found
    @singer.update!(profile_complete: true)
    post "/api/bookings", params: { musicianId: @singer.id, eventType: "wedding", city: "Pune", eventDate: 2.months.from_now.to_date.iso8601 }, headers: auth(@singer), as: :json
    assert_response :conflict
  end

  # ---- J-25 ----

  test "booking limits report the plan's room before the form is filled" do
    get "/api/bookings/limits", headers: auth(@hirer)
    assert_response :success
    assert_equal({ "activeAllowed" => 2, "activeUsed" => 0, "plan" => "free" }, response.parsed_body.slice("activeAllowed", "activeUsed", "plan"))
    2.times { post "/api/bookings", params: { musicianId: @drummer.id, eventType: "wedding", city: "Mumbai", eventDate: 2.months.from_now.to_date.iso8601 }, headers: auth(@hirer), as: :json }
    get "/api/bookings/limits", headers: auth(@hirer)
    assert_equal 2, response.parsed_body["activeUsed"]
  end

  test "asking for changes with a message puts it in the pair's conversation for the other side" do
    post "/api/bookings", params: { musicianId: @drummer.id, eventType: "wedding", city: "Mumbai", eventDate: 2.months.from_now.to_date.iso8601 }, headers: auth(@hirer), as: :json
    booking = BookingRequest.find(response.parsed_body.fetch("id"))

    post "/api/bookings/#{booking.id}/status", params: { status: "negotiating", message: "Can you do a 90 minute set?" }, headers: auth(@hirer), as: :json
    assert_response :success
    conversation = Conversation.find(response.parsed_body.fetch("conversationId"))
    assert_includes conversation.messages.last.body, "Can you do a 90 minute set?"
    assert_equal @hirer.id, conversation.messages.last.sender_id
    assert Notification.exists?(user: @drummer, kind: "message")

    post "/api/bookings/#{booking.id}/status", params: { status: "negotiating", message: "x" * 1_001 }, headers: auth(@hirer), as: :json
    assert_response :unprocessable_content
  end

  # ---- verificationPending ----

  test "me reports a waiting verification request, and clears it once verified" do
    get "/api/me", headers: auth(@singer)
    assert_equal [false, nil], response.parsed_body.fetch("user").values_at("verificationPending", "verificationRequestedAt")

    request = VerificationRequest.create!(user: @singer, kind: "professional", evidence_url: "https://example.com/me")
    get "/api/me", headers: auth(@singer)
    user = response.parsed_body.fetch("user")
    assert_equal true, user["verificationPending"]
    assert user["verificationRequestedAt"].present?

    request.update!(status: "approved")
    @singer.profile.update!(verified: true)
    get "/api/me", headers: auth(@singer)
    assert_equal false, response.parsed_body.dig("user", "verificationPending")
  end

  # ---- A-16 ----

  test "submitting the same opportunity twice in a row creates one listing" do
    body = { status: "pending", title: "Session drummer", description: "A day of recording in Mumbai, tracking drums for an EP release.", company: "Hira Studios", location: "Mumbai", opportunityKind: "session" }
    post "/api/jobs", params: body, headers: auth(@hirer), as: :json
    assert_response :created
    first_id = response.parsed_body.fetch("id")
    assert_no_difference "Job.count" do
      post "/api/jobs", params: body, headers: auth(@hirer), as: :json
    end
    assert_response :created
    assert_equal first_id, response.parsed_body.fetch("id")

    # A different listing, or a draft, is not a repeat.
    assert_difference "Job.count", 1 do
      post "/api/jobs", params: body.merge(status: "draft"), headers: auth(@hirer), as: :json
    end
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
