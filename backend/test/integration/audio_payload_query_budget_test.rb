require "test_helper"
require_relative "../support/query_budget"

# R6: the audio payload (AudioSet) of work samples is resolved with the images' lookup, one upload
# query per request, so a profile with many uploaded tracks costs the same number of statements as
# one with a single track (budgets: docs/PERFORMANCE.md, hot_endpoint_query_budget_test.rb).
class AudioPayloadQueryBudgetTest < ActionDispatch::IntegrationTest
  include QueryBudget

  setup do
    @musician = create_user("Audio Budget Drummer", "audio-budget-drummer@example.com")
    @musician.profile.update!(headline: "Session drummer", location: "Mumbai", roles: ["Drummer"], session_rate: 5000, verified: true)
    @headers = { "Authorization" => "Bearer #{session_for(@musician)}" }
  end

  test "the public talent detail and the owner's portfolio list cost the same with one track as with many" do
    add_track
    few = measure
    5.times { add_track }
    many = measure
    assert_equal few, many, "queries must not grow with the number of uploaded tracks"
    # The talent detail (12) and the portfolio list were already budgeted before audio sets; they must not exceed it.
    assert_operator many[:public], :<=, 12
  end

  test "both endpoints carry the audio set of every uploaded track, and null for a link" do
    uploaded = 3.times.map { add_track }
    PortfolioItem.create!(user: @musician, kind: "audio", title: "Link", url: "https://soundcloud.com/someone/track", visibility: "public")

    get "/api/public/talent/#{@musician.id}"
    assert_response :success
    assert_audio_sets(response.parsed_body["portfolio"], uploaded)
    get "/api/portfolio", headers: @headers
    assert_response :success
    assert_audio_sets(response.parsed_body["items"], uploaded)
  end

  private

  def create_user(name, email)
    User.create!(name:, email:, password: "StrongPass123!", role: "jobseeker", status: "active", profile_complete: true).tap { _1.create_profile! }
  end

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    raw
  end

  def measure
    get "/api/public/talent/#{@musician.id}" # warm-up: schema and caches
    get "/api/portfolio", headers: @headers
    public_count = assert_queries_at_most(30, "public talent detail") { get "/api/public/talent/#{@musician.id}" }
    own_count = assert_queries_at_most(30, "owner portfolio list") { get "/api/portfolio", headers: @headers }
    { public: public_count, own: own_count }
  end

  def add_track
    key = "uploads/#{@musician.id}/#{SecureRandom.uuid}/take.wav"
    upload = Upload.create!(user: @musician, storage: "s3", key:, filename: "take.wav", content_type: "audio/wav", byte_size: 1000, status: "complete",
      completed_at: Time.current, public_url: "https://media.example.test/#{key}",
      variants: { "audio" => { "duration" => 61.5, "variants" => %w[preview full peaks], "peaks" => 400 } })
    PortfolioItem.create!(user: @musician, kind: "audio", title: "Take #{SecureRandom.hex(2)}", url: upload.public_url, visibility: "public")
    upload
  end

  def assert_audio_sets(items, uploads)
    uploads.each do |upload|
      item = items.find { _1["url"] == upload.public_url }
      assert_equal "#{upload.public_url}/v/preview.m4a", item.dig("audio", "preview")
      assert_equal 61.5, item.dig("audio", "duration")
    end
    link = items.find { _1["url"].start_with?("https://soundcloud.com") }
    assert link.key?("audio")
    assert_nil link["audio"]
  end
end
