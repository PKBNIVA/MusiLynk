require "test_helper"

class AccountDataRightsTest < ActionDispatch::IntegrationTest
  setup do
    @seq = 0
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  test "export returns the user's own data as a download without secrets" do
    candidate = create_user("Export Candidate", "jobseeker")
    employer = create_user("Export Employer", "employer")
    candidate.profile.update!(headline: "Session bassist", phone: "+91 98200 00000")
    candidate.portfolio_items.create!(title: "Live at NH7", kind: "video", url: "https://example.com/live")
    job = create_job(employer)
    Application.create!(job:, candidate:)
    conversation = Conversation.create!(candidate:, employer:, job:)
    conversation.messages.create!(sender: employer, body: "Can you do the Pune date?")
    conversation.messages.create!(sender: candidate, body: "Yes, I can.")

    get "/api/account/export", headers: auth(candidate)

    assert_response :success
    assert_match(/attachment; filename="musilynk-data-\d{4}-\d{2}-\d{2}\.json"/, response.headers["Content-Disposition"])
    assert_equal "no-store", response.headers["Cache-Control"]
    data = response.parsed_body
    assert_equal candidate.email, data.dig("account", "email")
    assert_equal "Session bassist", data.dig("profile", "headline")
    assert_equal ["Live at NH7"], data["portfolio"].map { _1["title"] }
    assert_equal [job.title], data["applications"].map { _1.dig("job", "title") }
    messages = data["conversations"].sole["messages"]
    assert_equal [["Export Employer", "Can you do the Pune date?"], ["you", "Yes, I can."]], messages.map { _1.values_at("from", "body") }
    refute_includes response.body, "password_digest"
    refute_includes response.body, "token_digest"
    refute_includes response.body, employer.email
    assert AuditLog.exists?(actor: candidate, action: "account.export")
  end

  test "export requires sign-in and is rate limited" do
    get "/api/account/export"
    assert_response :unauthorized

    user = create_user("Busy Exporter", "jobseeker")
    headers = auth(user)
    AccountController::EXPORTS_PER_HOUR.times do
      get "/api/account/export", headers: headers
      assert_response :success
    end
    get "/api/account/export", headers: headers
    assert_response :too_many_requests
  end

  test "deleting an account erases personal data, keeps what other people rely on, and frees the email" do
    candidate = create_user("Leaving Candidate", "jobseeker")
    employer = create_user("Staying Employer", "employer")
    candidate.profile.update!(headline: "Vocalist", phone: "+91 90000 00000")
    candidate.portfolio_items.create!(title: "Showreel", kind: "video", url: "https://example.com/reel")
    candidate.availability_windows.create!(start_at: 1.day.from_now, end_at: 2.days.from_now)
    candidate.job_alerts.create!(frequency: "weekly")
    other_job = create_job(employer)
    Application.create!(job: other_job, candidate:)
    SavedJob.create!(user: candidate, job: other_job)
    own_job = create_job(candidate)
    conversation = Conversation.create!(candidate:, employer:, job: other_job)
    conversation.messages.create!(sender: candidate, body: "Thanks for the call.")
    UserBlock.create!(blocker: employer, blocked: candidate)
    email = candidate.email
    headers = auth(candidate)

    delete "/api/account", params: { confirmEmail: " #{email.upcase} " }, headers: headers, as: :json

    assert_response :success
    candidate.reload
    assert candidate.deleted?
    assert_equal "Deleted account", candidate.name
    assert_match(/@deleted\.invalid\z/, candidate.email)
    assert_nil candidate.profile
    assert_empty candidate.sessions
    assert_empty candidate.portfolio_items
    assert_empty candidate.availability_windows
    assert_empty candidate.job_alerts
    assert_empty candidate.applications
    assert_empty candidate.saved_jobs
    assert_not UserBlock.exists?(blocked_id: candidate.id)
    assert own_job.reload.closed?
    assert_equal ["Thanks for the call."], conversation.messages.reload.map(&:body)
    assert AuditLog.exists?(actor_id: candidate.id, action: "account.delete")

    get "/api/me", headers: headers
    assert_response :unauthorized

    get "/api/conversations", headers: auth(employer)
    row = response.parsed_body.fetch("conversations").find { _1["id"] == conversation.id }
    assert_equal ["Deleted account", false], row.values_at("counterpartName", "counterpartActive")

    post "/api/auth/register", params: { name: "Back Again", email:, password: "StrongPass123!", role: "jobseeker" }, as: :json
    assert_response :created
  end

  test "deletion needs the account email typed exactly" do
    user = create_user("Careful User", "jobseeker")
    [nil, "", "someone-else@example.com", ["list"]].each do |confirm|
      delete "/api/account", params: { confirmEmail: confirm }, headers: auth(user), as: :json
      assert_response :unprocessable_content
      assert_equal "CONFIRMATION_MISMATCH", response.parsed_body["code"]
    end
    assert user.reload.active?
  end

  test "deletion is refused while a paid plan or an open booking depends on the account, and for admins" do
    subscriber = create_user("Subscriber", "employer")
    Subscription.create!(user: subscriber, plan_code: "employer_pro", provider: "internal", status: "active")
    delete "/api/account", params: { confirmEmail: subscriber.email }, headers: auth(subscriber), as: :json
    assert_response :conflict
    assert_equal "SUBSCRIPTION_ACTIVE", response.parsed_body["code"]

    owner = create_user("Act Owner", "jobseeker")
    requester = create_user("Wedding Planner", "employer")
    act = Act.create!(owner:, name: "Open Booking Act", act_type: "band", status: "active", currency: "INR", fee_basis: "event")
    BookingRequest.create!(act:, requester:, event_type: "wedding", event_date: 30.days.from_now.to_date, city: "Mumbai", currency: "INR", status: "quoted")
    [owner, requester].each do |user|
      delete "/api/account", params: { confirmEmail: user.email }, headers: auth(user), as: :json
      assert_response :conflict
      assert_equal "BOOKINGS_OPEN", response.parsed_body["code"]
    end

    admin = create_user("Only Admin", "admin")
    delete "/api/account", params: { confirmEmail: admin.email }, headers: auth(admin), as: :json
    assert_response :conflict
    assert_equal "ADMIN_ACCOUNT", response.parsed_body["code"]
    assert [subscriber, owner, requester, admin].all? { _1.reload.active? }
  end

  test "admins cannot restore a deleted account" do
    admin = create_user("Moderator", "admin")
    user = create_user("Gone User", "jobseeker")
    AccountErasure.new(user).call!

    patch "/api/admin/users/#{user.id}", params: { status: "active" }, headers: auth(admin), as: :json

    assert_response :conflict
    assert_equal "ACCOUNT_DELETED", response.parsed_body["code"]
    assert user.reload.deleted?
  end

  private

  def create_user(name, role)
    @seq += 1
    User.create!(name:, email: "rights-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active",
      profile_complete: true).tap { _1.create_profile! }
  end

  def create_job(employer)
    Job.create!(employer:, title: "Data Rights Opportunity #{@seq}", company: employer.name, location: "Mumbai", kind: "Contract", genre: "Pop",
      description: "A properly documented professional opportunity with clear responsibilities, written terms and collaborative production support.",
      status: "published")
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
