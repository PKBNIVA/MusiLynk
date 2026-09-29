require "test_helper"
require_relative "../support/showcase_helpers"

class LinkImportTest < ActionDispatch::IntegrationTest
  include ShowcaseHelpers

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @original_fetcher = LinkPreview.fetcher
    LinkPreview.fetcher = ->(_uri) { [200, { title: "A work sample", author_name: "Someone" }.to_json] }
  end

  teardown do
    LinkPreview.fetcher = @original_fetcher
    Rails.cache = @original_cache
  end

  test "an anonymous request drafts a profile from up to 8 links" do
    post "/api/link-import/draft", params: { links: ["https://soundcloud.com/some-artist/a-track"] }, as: :json
    assert_response :success
    body = response.parsed_body
    assert_equal 1, body["sources"].length
    assert_equal false, body["aiUsed"]
    assert body["draft"].key?("items")
  end

  test "an empty links list is rejected" do
    post "/api/link-import/draft", params: { links: [] }, as: :json
    assert_response :unprocessable_entity
    assert_equal "INVALID_URL", response.parsed_body["code"]
  end

  test "more than 8 links are truncated to 8" do
    links = (1..12).map { |n| "https://soundcloud.com/artist-#{n}/track" }
    post "/api/link-import/draft", params: { links: }, as: :json
    assert_response :success
    assert_equal 8, response.parsed_body["sources"].length
  end

  test "the draft endpoint is throttled per IP like link previews" do
    LinkImportController::DRAFTS_PER_IP.times do
      post "/api/link-import/draft", params: { links: ["https://soundcloud.com/some-artist/a-track"] }, as: :json
      assert_response :success
    end
    post "/api/link-import/draft", params: { links: ["https://soundcloud.com/some-artist/a-track"] }, as: :json
    assert_response :too_many_requests
  end

  test "a signed-in caller's own website is scraped as a generic page even off the allowlist" do
    original_page_fetcher = LinkImport::Resolver.page_fetcher
    user = make_user("Own Site User", profile: { website: "https://riyamusic.example" })
    LinkImport::Resolver.page_fetcher = ->(_url) { { status: 200, body: "<html><title>Riya's own site</title></html>", content_type: "text/html", final_url: "https://riyamusic.example" } }

    post "/api/link-import/draft", params: { links: ["https://riyamusic.example"] }, headers: auth(user), as: :json
    assert_response :success
    assert_equal "Riya's own site", response.parsed_body.dig("sources", 0, "title")
  ensure
    LinkImport::Resolver.page_fetcher = original_page_fetcher
  end
end
