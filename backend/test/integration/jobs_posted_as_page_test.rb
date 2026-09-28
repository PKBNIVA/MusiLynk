require "test_helper"
require_relative "../support/showcase_helpers"

# Jobs posted as a Page: employer_id stays the person, posted_as_* names the Page.
class JobsPostedAsPageTest < ActionDispatch::IntegrationTest
  include ShowcaseHelpers

  JOB = { title: "Session keys player", location: "Mumbai", type: "Contract", description: "A" * 90, status: "draft" }.freeze

  setup do
    @owner = make_user("Riya Keys", "employer", profile: { company_name: "Riya Personal" })
    @studio = make_org(@owner, "Riya Studios")
    @band = make_act(@owner, "The Night Shift")
    @stranger = make_user("Other Person", "employer")
    @label = make_org(@stranger, "Some Label")
    @label.organization_members.create!(user: @owner, role: "member")
  end

  test "creating as an organization stores the Page, defaults company to its name and keeps the person as employer" do
    post "/api/jobs", params: JOB, headers: auth(@owner, as: "organization:#{@studio.id}"), as: :json
    assert_response :created
    assert_equal({ "type" => "organization", "id" => @studio.id, "name" => "Riya Studios" }, json["postedAs"])
    job = Job.find(json["id"])
    assert_equal [@owner.id, "Riya Studios", "organization", @studio.id], [job.employer_id, job.company, job.posted_as_type, job.posted_as_id]
    assert_equal "organization:#{@studio.id}", AuditLog.find_by(action: "job.create", entity_id: job.id).metadata["postedAs"]
  end

  test "an explicit company wins, the actingAs param works and a personal post has no postedAs" do
    post "/api/jobs", params: JOB.merge(company: "Night Shift Live", actingAs: "act:#{@band.id}"), headers: auth(@owner), as: :json
    assert_response :created
    job = Job.find(json["id"])
    assert_equal ["Night Shift Live", "act", @band.id], [job.company, job.posted_as_type, job.posted_as_id]

    post "/api/jobs", params: JOB, headers: auth(@owner), as: :json
    assert_response :created
    assert_nil json["postedAs"]
    personal = Job.find(json["id"])
    assert_equal ["Riya Personal", nil], [personal.company, personal.posted_as_type]
  end

  test "a plain member, a stranger's page, a hidden act and a malformed key are refused" do
    hidden = make_act(@owner, "Old Band", status: "hidden")
    ["organization:#{@label.id}", "act:#{hidden.id}", "user:#{@stranger.id}", "venue:1"].each do |key|
      assert_no_difference -> { Job.count } do
        post "/api/jobs", params: JOB, headers: auth(@owner, as: key), as: :json
      end
      assert_response :forbidden, key
      assert_equal "ACT_AS_FORBIDDEN", json["code"]
    end
  end

  test "listing, detail, saved jobs and the Page's public list show postedAs" do
    job = published_job(@owner, company: "Riya Studios", posted_as_type: "organization", posted_as_id: @studio.id)
    personal = published_job(@owner, title: "Personal gig")
    seeker = make_user("Seeker")
    SavedJob.create!(user: seeker, job:)

    get "/api/jobs"
    rows = json["jobs"].index_by { _1["id"] }
    assert_equal "Riya Studios", rows[job.id].dig("postedAs", "name")
    assert_nil rows[personal.id]["postedAs"]
    get "/api/jobs/#{job.id}"
    assert_equal({ "type" => "organization", "id" => @studio.id, "name" => "Riya Studios" }, json.dig("job", "postedAs"))
    get "/api/saved-jobs", headers: auth(seeker)
    assert_equal @studio.id, json["jobs"].first.dig("postedAs", "id")

    get "/api/pages/organization/#{@studio.id}/jobs"
    assert_response :success
    assert_equal({ "type" => "organization", "id" => @studio.id, "name" => "Riya Studios" }, json["page"])
    assert_equal [job.id], json["jobs"].pluck("id")
  end

  test "a Page's public list leaves out drafts, other Pages and hidden or unknown Pages" do
    published_job(@owner, posted_as_type: "act", posted_as_id: @band.id, status: "draft", published_at: nil)
    published_job(@owner, posted_as_type: "organization", posted_as_id: @studio.id)
    get "/api/pages/act/#{@band.id}/jobs"
    assert_response :success
    assert_empty json["jobs"]

    @band.update!(status: "hidden")
    get "/api/pages/act/#{@band.id}/jobs"
    assert_response :not_found
    get "/api/pages/venue/#{@band.id}/jobs"
    assert_response :not_found
    get "/api/pages/organization/#{@band.id}/jobs"
    assert_response :not_found
  end

  test "a hidden Page is not named to the public but still is to the owner" do
    job = published_job(@owner, posted_as_type: "act", posted_as_id: @band.id)
    @band.update!(status: "hidden")
    get "/api/jobs/#{job.id}"
    assert_nil json.dig("job", "postedAs")
    get "/api/jobs/#{job.id}", headers: auth(@owner)
    assert_equal @band.id, json.dig("job", "postedAs", "id")
  end

  test "employers filter their own jobs by postedAs" do
    studio_job = published_job(@owner, posted_as_type: "organization", posted_as_id: @studio.id)
    band_job = published_job(@owner, posted_as_type: "act", posted_as_id: @band.id)
    personal = published_job(@owner)
    published_job(@stranger, posted_as_type: "organization", posted_as_id: @label.id)
    headers = auth(@owner)

    get "/api/employer/jobs", headers: headers
    assert_equal [band_job.id, personal.id, studio_job.id].sort, json["jobs"].pluck("id").sort
    get "/api/employer/jobs", params: { postedAs: "organization:#{@studio.id}" }, headers: headers
    assert_equal [studio_job.id], json["jobs"].pluck("id")
    get "/api/employer/jobs", params: { postedAs: "act:#{@band.id}" }, headers: headers
    assert_equal [band_job.id], json["jobs"].pluck("id")
    get "/api/employer/jobs", params: { postedAs: "user:#{@owner.id}" }, headers: headers
    assert_equal [personal.id], json["jobs"].pluck("id")
    get "/api/employer/jobs", params: { postedAs: "organization:#{@label.id}" }, headers: headers
    assert_empty json["jobs"]
    get "/api/employer/jobs", params: { postedAs: "garbage" }, headers: headers
    assert_response :bad_request
  end

  test "updating while acting as a Page re-attaches the job and sends a live listing back to review" do
    job = published_job(@owner, company: "Riya Personal")
    patch "/api/employer/jobs/#{job.id}", params: { title: "Session keys (studio)" }, headers: auth(@owner, as: "organization:#{@studio.id}"), as: :json
    assert_response :success
    job.reload
    assert_equal ["organization", @studio.id, "Riya Studios", "pending"], [job.posted_as_type, job.posted_as_id, job.company, job.status]
    assert_equal "organization:#{@studio.id}", AuditLog.where(action: "job.update", entity_id: job.id).last.metadata["postedAs"]
    assert_equal "Riya Studios", json.dig("job", "postedAs", "name")
  end

  test "acting as yourself leaves the Page alone unless postedAs asks to post personally" do
    job = published_job(@owner, company: "Riya Studios", posted_as_type: "organization", posted_as_id: @studio.id, status: "draft")
    patch "/api/employer/jobs/#{job.id}", params: { title: "Retitled" }, headers: auth(@owner), as: :json
    assert_response :success
    assert_equal @studio.id, job.reload.posted_as_id

    patch "/api/employer/jobs/#{job.id}", params: { postedAs: "user:#{@owner.id}" }, headers: auth(@owner), as: :json
    assert_response :success
    assert_nil job.reload.posted_as_type

    patch "/api/employer/jobs/#{job.id}", params: { postedAs: "act:#{@band.id}", company: "Night Shift" }, headers: auth(@owner), as: :json
    assert_response :success
    assert_equal ["act", @band.id, "Night Shift"], [job.reload.posted_as_type, job.posted_as_id, job.company]

    patch "/api/employer/jobs/#{job.id}", params: { postedAs: "organization:#{@label.id}" }, headers: auth(@owner), as: :json
    assert_response :forbidden
    patch "/api/employer/jobs/#{job.id}", params: { title: "x" * 5 }, headers: auth(@owner, as: "organization:#{@label.id}"), as: :json
    assert_response :forbidden
    assert_equal @band.id, job.reload.posted_as_id
  end

  test "a status change while acting as the same Page is not an edit" do
    job = published_job(@owner, posted_as_type: "organization", posted_as_id: @studio.id)
    patch "/api/employer/jobs/#{job.id}", params: { status: "closed" }, headers: auth(@owner, as: "organization:#{@studio.id}"), as: :json
    assert_response :success
    assert_equal "closed", job.reload.status
    assert_equal "job.status", AuditLog.where(entity_id: job.id).last.action
  end

  test "another employer cannot re-attach someone else's job" do
    job = published_job(@owner)
    patch "/api/employer/jobs/#{job.id}", params: { title: "Mine now" }, headers: auth(@stranger, as: "organization:#{@label.id}"), as: :json
    assert_response :not_found
    assert_nil job.reload.posted_as_type
  end

  test "the model validates the posted-as type" do
    job = Job.new(employer: @owner, title: "x", company: "y", posted_as_type: "venue", posted_as_id: "1")
    assert_not job.valid?
    assert job.errors[:posted_as_type].any?
    job.posted_as_type = "act"
    job.posted_as_id = nil
    assert_not job.valid?
    assert job.errors[:posted_as_id].any?
  end
end
