require "test_helper"
require_relative "../support/showcase_helpers"

class LibraryImportsTest < ActionDispatch::IntegrationTest
  include ShowcaseHelpers

  test "creates portfolio items from draft items, skipping a URL already in the library" do
    user = make_user("Import User")
    make_item(user, "Existing", url: "https://example.com/existing")

    post "/api/library/import", params: {
      items: [{ url: "https://example.com/existing", title: "Existing (again)" },
              { url: "https://example.com/new", title: "New track", caption: "Recorded live" }]
    }, headers: auth(user), as: :json

    assert_response :success
    assert_equal 1, response.parsed_body["portfolioItems"].length
    assert_equal 2, user.portfolio_items.count
  end

  test "names an untitled Spotify link after what it is, not as a track" do
    user = make_user("Spotify User")
    post "/api/library/import", params: { items: [{ url: "https://open.spotify.com/artist/abc123" },
                                                  { url: "https://open.spotify.com/intl-in/album/def456" },
                                                  { url: "https://open.spotify.com/track/ghi789" }] }, headers: auth(user), as: :json
    assert_response :success
    assert_equal ["Spotify album", "Spotify artist", "Spotify track"], user.portfolio_items.pluck(:title).sort
  end

  test "merges roles, genres, instruments and credits into the profile without deleting existing values" do
    user = make_user("Merge User", profile: { roles: ["Vocalist"], genres: ["Rock"] })

    post "/api/library/import", params: { roles: ["Vocalist", "Guitarist"], genres: ["Indie"], instruments: ["Piano"],
                                            credits: [{ text: "Toured with a famous band" }] }, headers: auth(user), as: :json

    assert_response :success
    user.profile.reload
    assert_equal ["Vocalist", "Guitarist"], user.profile.roles
    assert_equal ["Rock", "Indie"], user.profile.genres
    assert_equal ["Piano"], user.profile.instruments
    assert_equal ["Toured with a famous band"], user.profile.credits
  end

  test "sets headline/bio directly when blank, but only raises a review suggestion when they are not" do
    blank_user = make_user("Blank Fields User")
    post "/api/library/import", params: { headline: "Session guitarist in Mumbai", bio: "I play guitar for a living." },
      headers: auth(blank_user), as: :json
    assert_response :success
    blank_user.profile.reload
    assert_equal "Session guitarist in Mumbai", blank_user.profile.headline
    assert_nil response.parsed_body["suggestedReview"]

    written_user = make_user("Existing Fields User", profile: { headline: "My own headline", bio: "My own bio." })
    post "/api/library/import", params: { headline: "AI-drafted headline", bio: "AI-drafted bio." }, headers: auth(written_user), as: :json
    assert_response :success
    written_user.profile.reload
    assert_equal "My own headline", written_user.profile.headline, "an existing headline is never overwritten"
    assert_equal "My own bio.", written_user.profile.bio
    suggestion = ShowcaseSuggestion.find_by(owner_id: written_user.id, kind: "profile_fields")
    assert suggestion
    assert_equal "AI-drafted headline", suggestion.payload["headline"]
  end

  test "accepting a profile_fields suggestion fills the field only if it is still blank" do
    user = make_user("Accept User", profile: {})
    suggestion = ShowcaseSuggestion.raise!(owner_type: "user", owner_id: user.id, target: user.profile, subject: user.profile,
      kind: "profile_fields", reason: "test", payload: { "headline" => "Drafted headline" })

    assert suggestion.accept!
    user.profile.reload
    assert_equal "Drafted headline", user.profile.headline

    other = make_user("Written Meanwhile User", profile: { headline: "Already written" })
    other_suggestion = ShowcaseSuggestion.raise!(owner_type: "user", owner_id: other.id, target: other.profile, subject: other.profile,
      kind: "profile_fields", reason: "test", payload: { "headline" => "Drafted headline" })
    other_suggestion.accept!
    other.profile.reload
    assert_equal "Already written", other.profile.headline
  end

  test "importing the same items twice never duplicates a work sample" do
    user = make_user("Idempotent User")
    body = { items: [{ url: "https://example.com/one", title: "One" }] }
    post "/api/library/import", params: body, headers: auth(user), as: :json
    post "/api/library/import", params: body, headers: auth(user), as: :json
    assert_equal 1, user.portfolio_items.count
  end
end
