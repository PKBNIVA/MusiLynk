require "test_helper"

# POST /reports (ReportsController#create): field validation, entity allow-list + existence,
# reason allow-list and duplicate-report rejection.
class ReportsTest < ActionDispatch::IntegrationTest
  setup do
    @seq = 0
    @reporter = create_user("Reporter One", "jobseeker")
    @employer = create_user("Reported Employer", "employer")
    @job = Job.create!(employer: @employer, title: "Reportable Opportunity", company: @employer.name, location: "Mumbai", kind: "Contract", genre: "Pop",
      description: "A properly documented professional opportunity with clear responsibilities, written terms and collaborative production support.",
      status: "published")
  end

  test "requires authentication" do
    post "/api/reports", params: { entityType: "job", entityId: @job.id, reason: "Spam or scam" }, as: :json
    assert_response :unauthorized
  end

  test "requires entityType, entityId and reason" do
    post "/api/reports", params: { entityType: "job", entityId: @job.id }, headers: auth(@reporter), as: :json
    assert_response :unprocessable_content
    assert_equal "INVALID_REPORT", response.parsed_body["code"]
  end

  test "rejects an entity type outside the allow-list" do
    post "/api/reports", params: { entityType: "conversation", entityId: @job.id, reason: "Spam or scam" }, headers: auth(@reporter), as: :json
    assert_response :unprocessable_content
    assert_equal "INVALID_ENTITY_TYPE", response.parsed_body["code"]
  end

  test "rejects a reason outside the fixed list" do
    post "/api/reports", params: { entityType: "job", entityId: @job.id, reason: "Just because" }, headers: auth(@reporter), as: :json
    assert_response :unprocessable_content
    assert_equal "INVALID_REASON", response.parsed_body["code"]
  end

  test "rejects a report on an entity that does not exist" do
    post "/api/reports", params: { entityType: "job", entityId: "job_missing", reason: "Spam or scam" }, headers: auth(@reporter), as: :json
    assert_response :not_found
    assert_equal "ENTITY_NOT_FOUND", response.parsed_body["code"]
  end

  test "creates a report for each allow-listed entity type when it exists" do
    talent = create_user("Talent Two", "jobseeker")
    act = Act.create!(owner: @employer, name: "Reportable Act", act_type: "Band", currency: "INR", fee_basis: "event", status: "active")
    review = Review.create!(author: talent, employer: @employer, rating: 4, body: "A solid, professional booking experience overall.", status: "published")

    [["user", @employer.id], ["job", @job.id], ["act", act.id], ["review", review.id]].each do |type, id|
      post "/api/reports", params: { entityType: type, entityId: id, reason: "Harassment" }, headers: auth(create_user("Reporter #{type}", "jobseeker")), as: :json
      assert_response :created, "expected a #{type} report to be created"
      assert Report.exists?(id: response.parsed_body["id"], entity_type: type, entity_id: id, status: "open")
    end
  end

  test "a stale client sending the old reason value is still accepted" do
    post "/api/reports", params: { entityType: "job", entityId: @job.id, reason: "Misleading listing" }, headers: auth(@reporter), as: :json
    assert_response :created
  end

  test "a user cannot report their own account" do
    post "/api/reports", params: { entityType: "user", entityId: @reporter.id, reason: "Spam or scam" }, headers: auth(@reporter), as: :json
    assert_response :unprocessable_content
    assert_equal "CANNOT_REPORT_SELF", response.parsed_body["code"]
    assert_equal "You can't report your own account.", response.parsed_body["error"]
    assert_not Report.exists?(reporter_id: @reporter.id, entity_type: "user")
  end

  test "a second open report on the same entity by the same reporter is rejected with a friendly message" do
    post "/api/reports", params: { entityType: "job", entityId: @job.id, reason: "Spam or scam" }, headers: auth(@reporter), as: :json
    assert_response :created

    post "/api/reports", params: { entityType: "job", entityId: @job.id, reason: "Misleading listing" }, headers: auth(@reporter), as: :json
    assert_response :conflict
    assert_equal "ALREADY_REPORTED", response.parsed_body["code"]
    assert_match(/already have an open report/i, response.parsed_body["error"])
    assert_equal 1, Report.where(reporter: @reporter, entity_type: "job", entity_id: @job.id).count
  end

  test "a new report is allowed once the earlier one on the same entity is closed" do
    first = Report.create!(reporter: @reporter, entity_type: "job", entity_id: @job.id, reason: "Spam or scam", status: "resolved")
    post "/api/reports", params: { entityType: "job", entityId: @job.id, reason: "Misleading listing" }, headers: auth(@reporter), as: :json
    assert_response :created
    assert_not_equal first.id, response.parsed_body["id"]
  end

  test "a different reporter may still report the same entity while one report is open" do
    post "/api/reports", params: { entityType: "job", entityId: @job.id, reason: "Spam or scam" }, headers: auth(@reporter), as: :json
    assert_response :created

    other = create_user("Reporter Two", "jobseeker")
    post "/api/reports", params: { entityType: "job", entityId: @job.id, reason: "Misleading listing" }, headers: auth(other), as: :json
    assert_response :created
  end

  private

  def create_user(name, role)
    @seq += 1
    User.create!(name:, email: "report-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active",
      profile_complete: true).tap { _1.create_profile! }
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
