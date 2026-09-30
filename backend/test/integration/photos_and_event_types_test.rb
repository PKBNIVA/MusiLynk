require "test_helper"

# profiles.photo_url / acts.photo_url (only ever an image the caller uploaded, or the Google
# avatar copied in), profiles.event_types, the public payload, the Stage author avatar and the
# upload sweep that must not purge a photo in use.
class PhotosAndEventTypesTest < ActionDispatch::IntegrationTest
  PHOTO = "https://cdn.example.com/u/me/photo.webp".freeze

  test "a profile accepts the URL of its own finished image upload and exposes it publicly" do
    talent = create_user("Photo Talent")
    upload!(talent, PHOTO)
    put "/api/profile", params: { photoUrl: PHOTO, eventTypes: ["Wedding", "Corporate"] }, headers: auth(session_for(talent)), as: :json
    assert_response :success
    assert_equal PHOTO, talent.profile.reload.photo_url
    assert_equal ["Wedding", "Corporate"], talent.profile.event_types

    talent.update!(profile_complete: true)
    get "/api/public/talent/#{talent.id}"
    professional = response.parsed_body.fetch("professional")
    assert_equal PHOTO, professional["photoUrl"]
    assert_equal ["Wedding", "Corporate"], professional["eventTypes"]
  end

  test "a profile refuses a photo URL that is not the caller's finished image upload" do
    talent = create_user("Photo Talent")
    other = create_user("Other Talent")
    upload!(other, PHOTO)
    upload!(talent, "https://cdn.example.com/u/me/track.mp3", content_type: "audio/mpeg")
    upload!(talent, "https://cdn.example.com/u/me/pending.png", content_type: "image/png", status: "pending")
    upload!(talent, "https://cdn.example.com/u/me/huge.png", content_type: "image/png", byte_size: 6.megabytes)
    token = session_for(talent)

    [PHOTO, "https://cdn.example.com/u/me/track.mp3", "https://cdn.example.com/u/me/pending.png", "https://cdn.example.com/u/me/huge.png", "https://tracker.example.net/pixel.png"].each do |url|
      put "/api/profile", params: { photoUrl: url }, headers: auth(token), as: :json
      assert_response :unprocessable_content, url
      assert_predicate response.parsed_body.dig("fields", "photoUrl"), :present?
    end
    assert_nil talent.profile.reload.photo_url
  end

  test "a profile keeps its current photo on later saves and can remove it" do
    talent = create_user("Photo Talent")
    talent.profile.update!(photo_url: "https://lh3.googleusercontent.com/a/x=s96")
    token = session_for(talent)

    put "/api/profile", params: { photoUrl: "https://lh3.googleusercontent.com/a/x=s96", headline: "Tabla" }, headers: auth(token), as: :json
    assert_response :success

    put "/api/profile", params: { photoUrl: "" }, headers: auth(token), as: :json
    assert_response :success
    assert_nil talent.profile.reload.photo_url
  end

  test "an act takes a photo only from the owner's image uploads" do
    owner = create_user("Act Owner")
    token = session_for(owner)
    upload!(owner, PHOTO)

    post "/api/acts", params: { name: "Photo Act", actType: "trio", photoUrl: "https://tracker.example.net/pixel.png" }, headers: auth(token), as: :json
    assert_response :unprocessable_content

    post "/api/acts", params: { name: "Photo Act", actType: "trio", photoUrl: PHOTO }, headers: auth(token), as: :json
    assert_response :created
    act_id = response.parsed_body.fetch("id")
    assert_equal PHOTO, response.parsed_body.dig("act", "photo_url")

    patch "/api/acts/#{act_id}", params: { tagline: "Tight", photoUrl: "https://tracker.example.net/pixel.png" }, headers: auth(token), as: :json
    assert_response :unprocessable_content
    patch "/api/acts/#{act_id}", params: { tagline: "Tight" }, headers: auth(token), as: :json
    assert_response :success

    get "/api/public/acts/#{act_id}"
    assert_equal PHOTO, response.parsed_body.dig("act", "photo_url")

    patch "/api/acts/#{act_id}", params: { photoUrl: "" }, headers: auth(token), as: :json
    assert_response :success
    assert_nil Act.find(act_id).photo_url
  end

  test "the Stage author avatar is the profile photo for people and the photo for acts" do
    talent = create_user("Stage Talent")
    post = Post.create!(author_type: "user", author_id: talent.id, created_by_user_id: talent.id, kind: "update", body: "Hello")
    assert_nil post.api_json[:author][:avatar]

    talent.profile.update!(photo_url: PHOTO)
    assert_equal PHOTO, Post.find(post.id).api_json[:author][:avatar]

    act = talent.owned_acts.create!(name: "Stage Act", act_type: "duo", currency: "INR", fee_basis: "event", status: "active", photo_url: PHOTO)
    act_post = Post.create!(author_type: "act", author_id: act.id, created_by_user_id: talent.id, kind: "update", body: "Hi")
    assert_equal PHOTO, act_post.api_json[:author][:avatar]
  end

  test "the upload sweep treats a profile or act photo as referenced" do
    talent = create_user("Sweep Talent")
    upload = upload!(talent, PHOTO)
    assert_includes Upload.unreferenced, upload
    assert_not upload.referenced?

    talent.profile.update!(photo_url: PHOTO)
    assert_not_includes Upload.unreferenced, upload
    assert upload.referenced?

    talent.profile.update!(photo_url: nil)
    talent.owned_acts.create!(name: "Sweep Act", act_type: "duo", currency: "INR", fee_basis: "event", status: "active", photo_url: PHOTO)
    assert_not_includes Upload.unreferenced, upload
    assert upload.referenced?
  end

  private

  def create_user(name)
    User.create!(name:, email: "photos-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", email_verified: true)
      .tap { _1.create_profile! }
  end

  def upload!(user, url, content_type: "image/webp", status: "complete", byte_size: 1000)
    Upload.create!(user:, storage: "s3", key: "k/#{SecureRandom.hex(6)}", filename: "f", content_type:, byte_size:, status:, public_url: url,
      completed_at: (Time.current if status == "complete"))
  end

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    raw
  end

  def auth(token) = { "Authorization" => "Bearer #{token}" }
end
