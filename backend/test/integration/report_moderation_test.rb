require "test_helper"

# Report review (conversation excerpt and history), moderation decisions and scam signals on messages.
class ReportModerationTest < ActionDispatch::IntegrationTest
  setup do
    @seq = 0
    @admin = create_user("Mod Admin", "admin")
    @employer = create_user("Shady Casting", "employer")
    @talent = create_user("Asha Singer", "jobseeker")
    @conversation = Conversation.create!(candidate: @talent, employer: @employer)
  end

  test "a new message is flagged for scam patterns and only the recipient sees the flag" do
    path = "/api/conversations/#{@conversation.id}/messages"
    flagged_before = Message.flagged.where(created_at: 30.days.ago..).count
    post path, params: { body: "Selected! Registration fee 1500 dena hoga. WhatsApp me on 98765 43210" }, headers: auth(@employer), as: :json
    assert_response :created
    assert_nil response.parsed_body["message"]["safetyFlags"], "the sender is not told the message was flagged"
    assert_equal %w[upfront_fee off_platform], latest_flags

    post path, params: { body: "Sure, what time is the audition?" }, headers: auth(@talent), as: :json
    assert_response :created
    assert_equal [], latest_flags

    get path, headers: auth(@talent)
    flags = response.parsed_body["messages"].map { _1["safetyFlags"] }
    assert_equal [%w[upfront_fee off_platform], nil], flags
    get path, headers: auth(@employer)
    assert(response.parsed_body["messages"].none? { _1.key?("safetyFlags") })

    get "/api/admin/stats", headers: auth(@admin)
    assert_equal flagged_before + 1, response.parsed_body.dig("stats", "flaggedMessages")
  end

  test "talent sharing their UPI for payment is not flagged, the hiring side doing so is" do
    path = "/api/conversations/#{@conversation.id}/messages"
    post path, params: { body: "My UPI is asha.sings@okaxis for the balance" }, headers: auth(@talent), as: :json
    assert_equal [], latest_flags
    post path, params: { body: "Pay the amount to casting.team@okaxis" }, headers: auth(@employer), as: :json
    assert_equal %w[payment_details], latest_flags
  end

  test "WhatsApp with a number is only an early-conversation signal" do
    path = "/api/conversations/#{@conversation.id}/messages"
    3.times { |i| post path, params: { body: "Rehearsal note #{i}" }, headers: auth(@employer), as: :json }
    post path, params: { body: "WhatsApp me on 9876543210 for the rider" }, headers: auth(@employer), as: :json
    assert_equal [], latest_flags
  end

  test "report context shows the conversation leading up to the report, the user's history, and is audit-logged" do
    25.times { |i| @conversation.messages.create!(sender: i.even? ? @employer : @talent, body: "message #{i}", created_at: (30 - i).minutes.ago) }
    @conversation.messages.create!(sender: @employer, body: "Pay the audition fee", safety_flags: %w[upfront_fee], created_at: 4.minutes.ago)
    report = report_from_conversation(@talent, @employer, created_at: 2.minutes.ago)
    @conversation.messages.create!(sender: @talent, body: "after the report", created_at: 1.minute.ago)
    Report.create!(reporter: @talent, entity_type: "user", entity_id: @employer.id, reason: "spam", status: "resolved", action_taken: "warn", created_at: 200.days.ago)
    job = create_job(@employer)
    Report.create!(reporter: @talent, entity_type: "job", entity_id: job.id, reason: "fake listing", status: "open")

    get "/api/admin/reports/#{report.id}/context", headers: auth(@admin)
    assert_response :success
    body = response.parsed_body
    assert_equal @employer.id, body.dig("reportedUser", "id")
    assert_equal "/community-guidelines", body["guidelinesUrl"]
    excerpt = body["conversation"]
    assert_equal @conversation.id, excerpt["id"]
    assert_equal Admin::ReportsController::EXCERPT_SIZE, excerpt["messages"].length
    assert_equal "Pay the audition fee", excerpt["messages"].last["body"]
    assert_equal %w[upfront_fee], excerpt["messages"].last["safetyFlags"]
    assert_equal "Shady Casting", excerpt["messages"].last["senderName"]
    assert_equal [6, 1], excerpt.values_at("earlierMessages", "laterMessages")
    assert_not_includes excerpt["messages"].map { _1["body"] }, "after the report"
    history = body["history"]
    assert_equal({ "reportsTotal" => 3, "reportsLast90Days" => 2, "openReports" => 1, "warnings" => 1, "suspensions" => 0, "flaggedMessagesLast90Days" => 1 }, history)

    log = AuditLog.where(action: "admin.report.context").order(:created_at).last
    assert_equal [@admin.id, report.id, @conversation.id, 20], [log.actor_id, log.entity_id, log.metadata["conversationId"], log.metadata["messagesShown"]]
  end

  test "report context ignores a conversation the reporter is not part of" do
    stranger = create_user("Stranger", "jobseeker")
    private_chat = Conversation.create!(candidate: stranger, employer: @employer)
    private_chat.messages.create!(sender: stranger, body: "private words")
    report = Report.create!(reporter: @talent, entity_type: "user", entity_id: @employer.id, reason: "harassment", status: "open",
      details: "Reported from conversation #{private_chat.id}.")

    get "/api/admin/reports/#{report.id}/context", headers: auth(@admin)
    assert_response :success
    assert_nil response.parsed_body["conversation"]
    assert_not_includes response.body, "private words"
  end

  test "report context for a listing report names the listing owner and has no conversation" do
    job = create_job(@employer)
    report = Report.create!(reporter: @talent, entity_type: "job", entity_id: job.id, reason: "scam", status: "open")
    get "/api/admin/reports/#{report.id}/context", headers: auth(@admin)
    assert_equal [@employer.id, nil], [response.parsed_body.dig("reportedUser", "id"), response.parsed_body["conversation"]]
  end

  test "report context and moderation are admin-only" do
    report = report_from_conversation(@talent, @employer)
    get "/api/admin/reports/#{report.id}/context", headers: auth(@talent)
    assert_response :forbidden
    post "/api/admin/reports/#{report.id}/moderate", params: { decision: "suspend" }, headers: auth(@employer), as: :json
    assert_response :forbidden
    assert @employer.reload.active?
  end

  test "warn notifies the reported user, resolves the report and records the decision" do
    report = report_from_conversation(@talent, @employer)
    post "/api/admin/reports/#{report.id}/moderate", params: { decision: "warn", note: "Do not ask artists for fees." }, headers: auth(@admin), as: :json
    assert_response :success
    report.reload
    assert_equal ["resolved", "warn", "Do not ask artists for fees.", @admin.id], [report.status, report.action_taken, report.resolution_note, report.resolved_by_id]
    notice = @employer.notifications.order(:created_at).last
    assert_equal ["moderation_warning", "Do not ask artists for fees.", "/community-guidelines"], [notice.kind, notice.body, notice.link]
    assert @employer.reload.active?
    log = AuditLog.where(action: "admin.report.warn").order(:created_at).last
    assert_equal [report.id, @employer.id], [log.entity_id, log.metadata["targetUserId"]]
  end

  test "warn without a note sends the default guidance" do
    report = report_from_conversation(@talent, @employer)
    post "/api/admin/reports/#{report.id}/moderate", params: { decision: "warn" }, headers: auth(@admin), as: :json
    assert_response :success
    assert_match "community guidelines", @employer.notifications.order(:created_at).last.body
    assert_nil report.reload.resolution_note
  end

  test "suspend suspends the reported user and revokes their sessions" do
    report = report_from_conversation(@talent, @employer)
    employer_headers = auth(@employer)
    post "/api/admin/reports/#{report.id}/moderate", params: { decision: "suspend", note: "Fee scam" }, headers: auth(@admin), as: :json
    assert_response :success
    assert_equal "suspended", @employer.reload.status
    assert_equal 0, @employer.sessions.count
    assert_equal %w[resolved suspend], report.reload.values_at(:status, :action_taken)
    assert AuditLog.exists?(action: "admin.user.status", entity_id: @employer.id)
    assert_equal 1, AuditLog.where(action: "admin.report.suspend").order(:created_at).last.metadata["sessionsRevoked"]
    get "/api/me", headers: employer_headers
    assert_response :unauthorized
  end

  test "dismiss closes the report without touching the reported user" do
    report = report_from_conversation(@talent, @employer)
    post "/api/admin/reports/#{report.id}/moderate", params: { decision: "dismiss" }, headers: auth(@admin), as: :json
    assert_response :success
    assert_equal %w[dismissed dismiss], report.reload.values_at(:status, :action_taken)
    assert @employer.reload.active?
    assert_empty @employer.notifications
    assert AuditLog.exists?(action: "admin.report.dismiss", entity_id: report.id)
  end

  test "moderation rejects bad input, closed reports and protected targets" do
    report = report_from_conversation(@talent, @employer)
    moderate = ->(id, params) { post "/api/admin/reports/#{id}/moderate", params:, headers: auth(@admin), as: :json }

    moderate.call(report.id, { decision: "ban" })
    assert_response :bad_request
    moderate.call(report.id, { decision: %w[warn] })
    assert_response :bad_request
    moderate.call(report.id, { decision: "warn", note: "x" * 1_001 })
    assert_response :unprocessable_content
    moderate.call("repo_missing", { decision: "warn" })
    assert_response :not_found

    about_admin = Report.create!(reporter: @talent, entity_type: "user", entity_id: @admin.id, reason: "rude", status: "open")
    moderate.call(about_admin.id, { decision: "suspend" })
    assert_response :conflict
    assert @admin.reload.active?

    about_nothing = Report.create!(reporter: @talent, entity_type: "review", entity_id: "rev_x", reason: "spam", status: "open")
    moderate.call(about_nothing.id, { decision: "warn" })
    assert_equal "NO_TARGET", response.parsed_body["code"]
    moderate.call(about_nothing.id, { decision: "dismiss" })
    assert_response :success

    moderate.call(report.id, { decision: "dismiss" })
    assert_response :success
    moderate.call(report.id, { decision: "suspend" })
    assert_response :conflict
    assert_equal "REPORT_CLOSED", response.parsed_body["code"]
    assert @employer.reload.active?, "a closed report cannot be used to suspend"
  end

  test "unpublish_job removes the job, auto-resolves other open reports on it and is audited" do
    job = create_job(@employer)
    report_a = Report.create!(reporter: @talent, entity_type: "job", entity_id: job.id, reason: "Misleading opportunity", status: "open")
    other_reporter = create_user("Other Reporter", "jobseeker")
    report_b = Report.create!(reporter: other_reporter, entity_type: "job", entity_id: job.id, reason: "Spam or scam", status: "open")

    post "/api/admin/reports/#{report_a.id}/moderate", params: { decision: "unpublish_job", note: "Removed after a safety report" }, headers: auth(@admin), as: :json
    assert_response :success
    assert_equal ["rejected", "Removed after a safety report"], job.reload.values_at(:status, :moderation_note)
    assert_equal %w[resolved unpublish_job], report_a.reload.values_at(:status, :action_taken)
    assert_equal %w[resolved unpublish_job], report_b.reload.values_at(:status, :action_taken)
    assert_includes response.parsed_body["resolvedReportIds"], report_b.id
    assert AuditLog.exists?(action: "admin.report.unpublish_job", entity_id: report_a.id)
    assert AuditLog.exists?(action: "admin.report.auto_resolved", entity_id: report_b.id)
  end

  test "hide_review rejects the review and hide_act hides the act; each only applies to its own entity type" do
    review = Review.create!(author: @talent, employer: @employer, rating: 2, body: "Not a great experience overall, in detail.", status: "published")
    report = Report.create!(reporter: @employer, entity_type: "review", entity_id: review.id, reason: "Harassment", status: "open")
    post "/api/admin/reports/#{report.id}/moderate", params: { decision: "hide_act" }, headers: auth(@admin), as: :json
    assert_response :unprocessable_content
    assert_equal "WRONG_ENTITY_TYPE", response.parsed_body["code"]

    post "/api/admin/reports/#{report.id}/moderate", params: { decision: "hide_review" }, headers: auth(@admin), as: :json
    assert_response :success
    assert_equal "rejected", review.reload.status
    assert_equal %w[resolved hide_review], report.reload.values_at(:status, :action_taken)

    act = Act.create!(owner: @employer, name: "Test Act", act_type: "Band", currency: "INR", fee_basis: "event", status: "active")
    act_report = Report.create!(reporter: @talent, entity_type: "act", entity_id: act.id, reason: "Spam or scam", status: "open")
    post "/api/admin/reports/#{act_report.id}/moderate", params: { decision: "hide_act" }, headers: auth(@admin), as: :json
    assert_response :success
    assert_equal "hidden", act.reload.status
  end

  test "a closed report cannot be used for a content action" do
    job = create_job(@employer)
    report = Report.create!(reporter: @talent, entity_type: "job", entity_id: job.id, reason: "Spam or scam", status: "dismissed")
    post "/api/admin/reports/#{report.id}/moderate", params: { decision: "unpublish_job" }, headers: auth(@admin), as: :json
    assert_response :conflict
    assert_equal "REPORT_CLOSED", response.parsed_body["code"]
    assert job.reload.published?
  end

  test "reports index filters by status, entity type and reason, and paginates" do
    job = create_job(@employer)
    Report.create!(reporter: @talent, entity_type: "job", entity_id: job.id, reason: "Spam or scam", status: "open")
    Report.create!(reporter: @talent, entity_type: "user", entity_id: @employer.id, reason: "Harassment", status: "resolved")
    3.times { |i| Report.create!(reporter: @talent, entity_type: "user", entity_id: @employer.id, reason: "Harassment", status: "open", created_at: i.minutes.ago) }

    get "/api/admin/reports", params: { status: "open", entityType: "job" }, headers: auth(@admin)
    assert_response :success
    body = response.parsed_body
    assert_equal 1, body["total"]
    assert_equal "job", body["reports"].first["entity_type"]
    assert_equal job.title, body["reports"].first["entityTitle"]

    get "/api/admin/reports", params: { status: "open", entityType: "user", reason: "Harassment", perPage: "2" }, headers: auth(@admin)
    body = response.parsed_body
    assert_equal [3, 1, 2, 2], [body["total"], body["page"], body["perPage"], body["reports"].length]
  end

  private

  def latest_flags = @conversation.messages.order(:created_at, :id).last.safety_flags

  def report_from_conversation(reporter, reported, created_at: Time.current)
    Report.create!(reporter:, entity_type: "user", entity_id: reported.id, reason: "Asked me to pay a fee", status: "open",
      details: "They asked for money.\n\nReported from conversation #{@conversation.id}.", created_at:)
  end

  def create_user(name, role)
    @seq += 1
    User.create!(name:, email: "mod-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active",
      profile_complete: true).tap { _1.create_profile! }
  end

  def create_job(employer)
    Job.create!(employer:, title: "Moderation Opportunity #{@seq}", company: employer.name, location: "Mumbai", kind: "Contract", genre: "Pop",
      description: "A properly documented professional opportunity with clear responsibilities, written terms and collaborative production support.",
      status: "published")
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
