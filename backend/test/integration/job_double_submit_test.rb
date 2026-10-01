require "test_helper"

# A-16: a double-click or retry on "Submit for review" creates one listing, not two.
class JobDoubleSubmitTest < ActionDispatch::IntegrationTest
  setup do
    @hirer = User.create!(name: "Hira Hirer", email: "ds-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active", email_verified: true, profile_complete: true)
  end

  test "submitting the same opportunity twice in a row creates one listing" do
    body = { status: "pending", title: "Session drummer", description: "A day of recording in Mumbai, tracking drums for an EP release.", company: "Hira Studios", location: "Mumbai", opportunityKind: "session" }
    post "/api/jobs", params: body, headers: auth(@hirer), as: :json
    assert_response :created
    first_id = response.parsed_body.fetch("id")
    first_flags = response.parsed_body.fetch("moderationFlags")
    assert_no_difference "Job.count" do
      post "/api/jobs", params: body, headers: auth(@hirer), as: :json
    end
    assert_response :created
    assert_equal first_id, response.parsed_body.fetch("id")
    assert_equal first_flags, response.parsed_body.fetch("moderationFlags")

    # A draft is not a repeat.
    assert_difference "Job.count", 1 do
      post "/api/jobs", params: body.merge(status: "draft"), headers: auth(@hirer), as: :json
    end
  end

  private

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
