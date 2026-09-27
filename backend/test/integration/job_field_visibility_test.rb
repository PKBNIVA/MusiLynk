require "test_helper"

# Internal job columns (moderation_note: automated review hints and admin rejection reasons)
# are only returned to the job's owner and to admins.
class JobFieldVisibilityTest < ActionDispatch::IntegrationTest
  NOTE = "Possible fee request; admin: verify the company".freeze

  setup do
    @seq = 0
    @owner = create_user("Owner Label", "employer")
    @seeker = create_user("Seeker", "jobseeker")
    @other_employer = create_user("Other Label", "employer")
    @admin = create_user("Admin", "admin")
    @job = Job.create!(employer: @owner, title: "Session drummer", company: "Owner Label", location: "Pune", kind: "Contract", genre: "Rock",
      description: "A properly documented professional opportunity with clear responsibilities and written terms for the session.",
      status: "published", moderation_note: NOTE)
    SavedJob.create!(user: @seeker, job: @job)
  end

  test "public and non-owner responses never include internal job columns" do
    responses = {
      "anonymous list" => -> { get "/api/jobs"; response.parsed_body["jobs"].find { _1["id"] == @job.id } },
      "anonymous detail" => -> { get "/api/jobs/#{@job.id}"; response.parsed_body["job"] },
      "jobseeker list" => -> { get "/api/jobs", headers: auth(@seeker); response.parsed_body["jobs"].find { _1["id"] == @job.id } },
      "jobseeker detail" => -> { get "/api/jobs/#{@job.id}", headers: auth(@seeker); response.parsed_body["job"] },
      "other employer detail" => -> { get "/api/jobs/#{@job.id}", headers: auth(@other_employer); response.parsed_body["job"] },
      "saved jobs" => -> { get "/api/saved-jobs", headers: auth(@seeker); response.parsed_body["jobs"].first },
      "jobseeker dashboard" => -> { get "/api/dashboard", headers: auth(@seeker); response.parsed_body["recommendedJobs"].find { _1["id"] == @job.id } }
    }
    responses.each do |label, fetch|
      job = fetch.call
      assert_response :success, label
      assert job, "#{label}: job missing"
      assert_not job.key?("moderation_note"), "#{label} leaked moderation_note"
      assert_not_includes response.body, NOTE, label
      # What the listing pages read is still there.
      assert_equal [@job.id, "Session drummer", @owner.id, "Owner Label"], job.values_at("id", "title", "employer_id", "employerName"), label
      assert_includes job.keys, "applicationsCount", label
    end
  end

  test "the owner and admins still see the moderation note" do
    get "/api/jobs/#{@job.id}", headers: auth(@owner)
    assert_equal NOTE, response.parsed_body.dig("job", "moderation_note")
    get "/api/employer/jobs", headers: auth(@owner)
    assert_equal NOTE, response.parsed_body["jobs"].first["moderation_note"]
    get "/api/dashboard", headers: auth(@owner)
    assert_equal NOTE, response.parsed_body["recentJobs"].first["moderation_note"]
    get "/api/admin/jobs", headers: auth(@admin)
    assert_equal NOTE, response.parsed_body["jobs"].find { _1["id"] == @job.id }["moderation_note"]
  end

  test "new job columns are private unless listed as public" do
    assert_equal %w[moderation_note], Job.column_names - Job::PUBLIC_COLUMNS
    assert_equal({}, @job.api_json.slice("moderation_note"))
  end

  private

  def create_user(name, role)
    @seq += 1
    User.create!(name:, email: "jobfields-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active",
      profile_complete: true).tap { _1.create_profile! }
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
