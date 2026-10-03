require "test_helper"

# The responsive-image payload (ImageSet) wherever an upload is exposed: profile photo, act cover,
# work samples, Stage post media and the upload record itself. The old string fields stay.
class ImageSetPayloadTest < ActionDispatch::IntegrationTest
  BASE = "https://media.example.test".freeze
  VARIANTS = { "width" => 1500, "height" => 1000, "formats" => { "webp" => [320, 768], "avif" => [320, 768] }, "generatedAt" => "2026-10-03T10:00:00Z" }.freeze

  setup do
    @talent = User.create!(name: "Image Talent", email: "imageset-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role: "jobseeker",
      status: "active", email_verified: true, profile_complete: true)
    @talent.create_profile!(headline: "Drummer")
    @photo = upload!("face.jpg", variants: VARIANTS)
    @plain = upload!("old.jpg") # uploaded before variants existed, or whose job failed
    @talent.profile.update!(photo_url: @photo.public_url)
  end

  test "a profile photo with variants carries an image set beside photoUrl; one without keeps photoUrl alone" do
    get "/api/public/talent/#{@talent.id}"
    assert_response :success
    professional = response.parsed_body.fetch("professional")
    assert_equal @photo.public_url, professional["photoUrl"]
    assert_image_set professional.fetch("photo"), @photo

    @talent.profile.update!(photo_url: @plain.public_url)
    get "/api/public/talent/#{@talent.id}"
    professional = response.parsed_body.fetch("professional")
    assert_equal @plain.public_url, professional["photoUrl"]
    assert_nil professional["photo"]
    assert professional.key?("photo")

    get "/api/public/talent"
    assert_response :success
    rows = response.parsed_body.fetch("talent")
    row = rows.find { _1["id"] == @talent.id }
    assert row, "listed"
    assert_nil row["photo"]
  end

  test "the talent list resolves every card's photo" do
    get "/api/public/talent"
    assert_response :success
    row = response.parsed_body.fetch("talent").find { _1["id"] == @talent.id }
    assert_image_set row.fetch("photo"), @photo
  end

  test "an act cover and the owner's act list carry the image set" do
    act = Act.create!(owner: @talent, name: "Image Band", act_type: "band", status: "active", currency: "INR", fee_basis: "event", city: "Pune", photo_url: @photo.public_url)
    get "/api/public/acts/#{act.id}"
    assert_response :success
    assert_equal @photo.public_url, response.parsed_body.dig("act", "photo_url")
    assert_image_set response.parsed_body.dig("act", "photo"), @photo

    get "/api/public/acts"
    assert_response :success
    assert_image_set response.parsed_body.fetch("acts").find { _1["id"] == act.id }.fetch("photo"), @photo

    get "/api/acts/me", headers: auth
    assert_response :success
    assert_image_set response.parsed_body.fetch("acts").find { _1["id"] == act.id }.fetch("photo"), @photo
  end

  test "work samples carry image sets for an uploaded image and an uploaded thumbnail, never for links" do
    image = PortfolioItem.create!(user: @talent, kind: "image", title: "Stage shot", url: @photo.public_url, visibility: "public")
    thumbed = PortfolioItem.create!(user: @talent, kind: "audio", title: "Take", url: "https://example.com/take.mp3", thumbnail_url: @photo.public_url, visibility: "public")
    link = PortfolioItem.create!(user: @talent, kind: "video", title: "Clip", url: "https://www.youtube.com/watch?v=abcdefghijk", visibility: "public")

    get "/api/public/talent/#{@talent.id}"
    assert_response :success
    items = response.parsed_body.fetch("portfolio").index_by { _1["id"] }
    assert_image_set items[image.id].fetch("image"), @photo
    assert_nil items[image.id]["thumbnail"]
    assert_nil items[thumbed.id]["image"]
    assert_image_set items[thumbed.id].fetch("thumbnail"), @photo
    assert_nil items[link.id]["image"]
    assert_nil items[link.id]["thumbnail"]
    assert_equal @photo.public_url, items[image.id]["url"]

    get "/api/portfolio", headers: auth
    assert_response :success
    assert_image_set response.parsed_body.fetch("items").find { _1["id"] == image.id }.fetch("image"), @photo
  end

  test "Stage post media carries url and image for an attached image with variants" do
    post_record = Post.create!(author_type: "user", author_id: @talent.id, created_by_user_id: @talent.id, kind: "update", body: "Photos #gig",
      media: [{ uploadId: @photo.id, type: "image", caption: "Soundcheck" }, { uploadId: @plain.id, type: "image" }])
    get "/api/stage/tags/gig"
    assert_response :success
    found = response.parsed_body.fetch("posts").find { _1["id"] == post_record.id }
    media = found.fetch("media")
    assert_equal @photo.public_url, media[0]["url"]
    assert_equal "Soundcheck", media[0]["caption"]
    assert_image_set media[0].fetch("image"), @photo
    assert_equal @plain.public_url, media[1]["url"]
    assert_nil media[1]["image"]
  end

  test "the upload record itself exposes its image set, and variant URLs follow the issued public URL" do
    json = @photo.api_json
    assert_equal @photo.public_url, json[:url]
    assert_image_set json[:image].deep_stringify_keys, @photo
    assert_equal "#{@photo.public_url}/v/768.avif", @photo.variant_url(768, :avif)
    assert_nil @photo.variant_url(1600, "webp"), "a width that was not produced"
    assert_nil @plain.image_set
    assert_nil @plain.api_json[:image]
    assert_equal({ @photo.public_url => @photo.image_set }, ImageSet.by_url([@photo.public_url, @plain.public_url, nil, ""]))
    assert_equal({}, ImageSet.by_url([]))
  end

  private

  def assert_image_set(set, upload)
    assert_kind_of Hash, set, "image set present"
    assert_equal upload.public_url, set["src"]
    assert_equal 1500, set["width"]
    assert_equal 1000, set["height"]
    assert_equal %w[avif webp], set["srcset"].keys.sort
    assert_equal ["#{upload.public_url}/v/320.webp 320w", "#{upload.public_url}/v/768.webp 768w"], set["srcset"]["webp"]
    assert_equal ["#{upload.public_url}/v/320.avif 320w", "#{upload.public_url}/v/768.avif 768w"], set["srcset"]["avif"]
  end

  def upload!(filename, variants: {})
    key = "uploads/#{@talent.id}/#{SecureRandom.uuid}/#{filename}"
    Upload.create!(user: @talent, storage: "s3", key:, filename:, content_type: "image/jpeg", byte_size: 1000, status: "complete",
      completed_at: Time.current, public_url: "#{BASE}/#{key}", variants:)
  end

  def auth
    @auth ||= begin
      raw = SecureRandom.urlsafe_base64(48)
      @talent.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 1.day.from_now)
      { "Authorization" => "Bearer #{raw}" }
    end
  end
end
