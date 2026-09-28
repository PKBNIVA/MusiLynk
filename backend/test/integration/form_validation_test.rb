require "test_helper"

# Form validation contract: every invalid field is reported at once under `fields`, keyed by
# the camelCase request field, so the web forms can show each message next to its input.
class FormValidationTest < ActionDispatch::IntegrationTest
  setup do
    @seeker = User.create!(name: "Form Seeker", email: "form-seeker@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    @employer = User.create!(name: "Form Employer", email: "form-employer@example.com", password: "StrongPass123!", role: "employer", status: "active")
  end

  test "profile reports every invalid field at once, keeping the old sentence in error" do
    put "/api/profile", params: { hourlyRate: -1, showRate: "abc", currency: "XYZ", website: "not a url" }, headers: auth(@seeker), as: :json
    assert_response :unprocessable_content
    body = response.parsed_body
    assert_equal "VALIDATION_FAILED", body["code"]
    assert_equal ["Hourly rate cannot be negative"], body["fields"]["hourlyRate"]
    assert_equal ["Show rate must be a number"], body["fields"]["showRate"]
    assert_equal ["Currency must be one of INR, USD, EUR, GBP"], body["fields"]["currency"]
    assert_equal ["Website must be a valid HTTP or HTTPS URL"], body["fields"]["website"]
    assert_includes body["error"], "Hourly rate cannot be negative"
    assert_nil @seeker.reload.profile, "nothing is saved when any field is invalid"
  end

  test "an employer cannot save the organization profile without a company name" do
    put "/api/profile", params: { companyName: "   ", companyWebsite: "" }, headers: auth(@employer), as: :json
    assert_response :unprocessable_content
    assert_equal({ "companyName" => ["Enter your company, label or studio name."] }, response.parsed_body["fields"])

    put "/api/profile", params: { companyName: "Blue Room Studios" }, headers: auth(@employer), as: :json
    assert_response :success
    assert_equal "Blue Room Studios", @employer.reload.profile.company_name
  end

  test "partial updates that do not send the company name still work, and jobseekers never need one" do
    put "/api/profile", params: { location: "Pune" }, headers: auth(@employer), as: :json
    assert_response :success
    put "/api/profile", params: { companyName: "" }, headers: auth(@seeker), as: :json
    assert_response :success
  end

  test "profile phone must look like a phone number; text is trimmed and length-limited" do
    put "/api/profile", params: { phone: "abc-😀", headline: "h" * 161, companyWebsite: "ftp://x.example" }, headers: auth(@seeker), as: :json
    assert_response :unprocessable_content
    fields = response.parsed_body["fields"]
    assert_match(/Phone must be a phone number/, fields["phone"].first)
    assert_match(/Headline is too long \(maximum is 160 characters\)/, fields["headline"].first)
    assert_equal ["Company website must be a valid HTTP or HTTPS URL"], fields["companyWebsite"]

    put "/api/profile", params: { phone: " +91 98765 43210 ", headline: "  Playback singer · Vocal producer  " }, headers: auth(@seeker), as: :json
    assert_response :success
    profile = @seeker.reload.profile
    assert_equal ["+91 98765 43210", "Playback singer · Vocal producer"], [profile.phone, profile.headline]
  end

  test "older values over a new limit do not block saving other fields" do
    @seeker.create_profile!
    @seeker.profile.update_columns(bio: "b" * 3_000, phone: "call me")
    put "/api/profile", params: { location: "Goa" }, headers: auth(@seeker), as: :json
    assert_response :success
    assert_equal "Goa", @seeker.reload.profile.location
  end

  test "availability rejects past slots and end-before-start, per field" do
    post "/api/availability", params: { startAt: 2.days.ago.iso8601, endAt: 3.days.ago.iso8601 }, headers: auth(@seeker), as: :json
    assert_response :unprocessable_content
    fields = response.parsed_body["fields"]
    assert_equal ["Start at must be in the future"], fields["startAt"]
    assert_equal ["End at must be after the start"], fields["endAt"]

    post "/api/availability", params: { startAt: 1.minute.ago.iso8601, endAt: 2.hours.from_now.iso8601, city: "c" * 121 }, headers: auth(@seeker), as: :json
    assert_response :unprocessable_content
    assert_equal ["City is too long (maximum is 120 characters)"], response.parsed_body["fields"]["city"]

    post "/api/availability", params: { startAt: 1.minute.ago.iso8601, endAt: 2.hours.from_now.iso8601 }, headers: auth(@seeker), as: :json
    assert_response :created, "a minute of clock skew is tolerated"
    window = AvailabilityWindow.find(response.parsed_body["id"])
    window.update_columns(start_at: 1.week.ago, end_at: 6.days.ago)
    assert window.reload.valid?, "time passing never invalidates an existing window"
  end

  test "apply requires an answer to every screening question and stores question/answer pairs" do
    job = Job.create!(employer: @employer, title: "Session bassist", company: "Blue Room", location: "Pune", kind: "Contract", genre: "Jazz",
      description: "A professional session opportunity with written terms, rehearsals and a clear schedule for the band.",
      status: "published", screening_questions: ["Do you read charts?", "Which rig do you own?"])
    post "/api/jobs/#{job.id}/apply", params: { screeningAnswers: ["Yes", " "] }, headers: auth(@seeker), as: :json
    assert_response :unprocessable_content
    assert_equal "SCREENING_ANSWERS_REQUIRED", response.parsed_body["code"]
    assert_equal({ "screeningAnswer1" => ["Answer this question: Which rig do you own?"] }, response.parsed_body["fields"])
    assert_equal 0, job.applications.count

    post "/api/jobs/#{job.id}/apply", params: { screeningAnswers: ["Yes", "Do you read charts? :: wrong prefix is kept as text"] }, headers: auth(@seeker), as: :json
    assert_response :created
    assert_equal ["Do you read charts? :: Yes", "Which rig do you own? :: Do you read charts? :: wrong prefix is kept as text"],
      job.applications.last.screening_answers
  end

  test "apply accepts older clients that send 'Question :: answer'" do
    job = Job.create!(employer: @employer, title: "Tour drummer", company: "Blue Room", location: "Pune", kind: "Contract", genre: "Jazz",
      description: "A professional touring opportunity with written terms, rehearsals and a clear schedule for the band.",
      status: "published", screening_questions: ["Passport ready?"])
    post "/api/jobs/#{job.id}/apply", params: { screeningAnswers: ["Passport ready? :: Yes"] }, headers: auth(@seeker), as: :json
    assert_response :created
    assert_equal ["Passport ready? :: Yes"], job.applications.last.screening_answers
  end

  private

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
