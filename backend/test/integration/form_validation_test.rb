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

  private

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
