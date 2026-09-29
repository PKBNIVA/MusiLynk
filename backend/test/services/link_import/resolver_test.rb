require "test_helper"

class LinkImport::ResolverTest < ActiveSupport::TestCase
  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @original_http_client = LinkImport::Resolver.http_client
    @original_page_fetcher = LinkImport::Resolver.page_fetcher
  end

  teardown do
    Rails.cache = @original_cache
    LinkImport::Resolver.http_client = @original_http_client
    LinkImport::Resolver.page_fetcher = @original_page_fetcher
  end

  # --- YouTube channel ---------------------------------------------------------------------------

  test "a YouTube @handle without an API key resolves as a plain channel link" do
    with_env("YOUTUBE_API_KEY" => nil) do
      result = LinkImport::Resolver.call("https://www.youtube.com/@SomeArtist")
      assert_equal({ provider: "youtube", kind: "channel", url: "https://www.youtube.com/@SomeArtist", title: nil, author: nil,
                     thumbnail: nil, channel: nil, videos: [], label: "YouTube" }, result)
    end
  end

  test "a YouTube @handle with an API key fetches the channel and its 10 latest videos" do
    with_env("YOUTUBE_API_KEY" => "yt-key") do
      calls = []
      LinkImport::Resolver.http_client = lambda do |uri, **|
        calls << uri.to_s
        if uri.path == "/youtube/v3/channels"
          [200, { items: [{ id: "UC123", snippet: { title: "Some Artist", description: "Musician", thumbnails: { high: { url: "https://img/c.jpg" } } } }] }.to_json]
        else
          videos = (1..12).map { |n| { id: { videoId: "v#{n}" }, snippet: { title: "Video #{n}", thumbnails: { high: { url: "https://img/#{n}.jpg" } } } } }
          [200, { items: videos }.to_json]
        end
      end

      result = LinkImport::Resolver.call("https://www.youtube.com/@SomeArtist")
      assert_equal "youtube", result[:provider]
      assert_equal "Some Artist", result[:title]
      assert_equal "UC123", result[:channel][:id]
      assert_equal 10, result[:videos].length
      assert_equal "https://www.youtube.com/watch?v=v1", result[:videos].first[:url]
      assert_includes calls.first, "forHandle=%40SomeArtist"
    end
  end

  # --- SoundCloud profile --------------------------------------------------------------------------

  test "a SoundCloud profile URL stays a plain channel link even with no API available" do
    result = LinkImport::Resolver.call("https://soundcloud.com/some-artist")
    assert_equal({ provider: "soundcloud", kind: "channel", url: "https://soundcloud.com/some-artist", title: nil, author: nil, thumbnail: nil, label: "SoundCloud" }, result)
  end

  test "a SoundCloud track URL (two path segments) is left to LinkPreview, not treated as a profile" do
    LinkPreview.fetcher = ->(_uri) { [200, { title: "A track" }.to_json] }
    result = LinkImport::Resolver.call("https://soundcloud.com/some-artist/a-track")
    assert_equal "audio", result[:kind]
    assert_equal "A track", result[:title]
  end

  # --- Spotify --------------------------------------------------------------------------------------

  test "a Spotify artist URL without credentials resolves as a plain audio link" do
    with_env("SPOTIFY_CLIENT_ID" => nil, "SPOTIFY_CLIENT_SECRET" => nil) do
      result = LinkImport::Resolver.call("https://open.spotify.com/artist/abc123")
      assert_equal({ provider: "spotify", kind: "audio", url: "https://open.spotify.com/artist/abc123", title: nil, author: nil,
                     thumbnail: nil, artist: nil, tracks: [], label: "Spotify" }, result)
    end
  end

  test "a Spotify artist URL with credentials fetches the client-credentials token, artist and top tracks" do
    with_env("SPOTIFY_CLIENT_ID" => "id", "SPOTIFY_CLIENT_SECRET" => "secret") do
      LinkImport::Resolver.http_client = lambda do |uri, headers: {}, body: nil, method: :get|
        if uri.host == "accounts.spotify.com"
          [200, { access_token: "tok", expires_in: 3600 }.to_json]
        elsif uri.path == "/v1/artists/abc123"
          [200, { name: "Some Artist", images: [{ url: "https://img/artist.jpg" }], genres: %w[indie pop], followers: { total: 5000 } }.to_json]
        elsif uri.path == "/v1/artists/abc123/top-tracks"
          [200, { tracks: (1..12).map { |n| { name: "Track #{n}", external_urls: { spotify: "https://open.spotify.com/track/#{n}" } } } }.to_json]
        end
      end

      result = LinkImport::Resolver.call("https://open.spotify.com/artist/abc123")
      assert_equal "Some Artist", result[:artist][:name]
      assert_equal %w[indie pop], result[:artist][:genres]
      assert_equal 5000, result[:artist][:followers]
      assert_equal 10, result[:tracks].length
    end
  end

  test "the Spotify token is cached until it expires" do
    with_env("SPOTIFY_CLIENT_ID" => "id", "SPOTIFY_CLIENT_SECRET" => "secret") do
      token_calls = 0
      LinkImport::Resolver.http_client = lambda do |uri, **|
        if uri.host == "accounts.spotify.com"
          token_calls += 1
          [200, { access_token: "tok", expires_in: 3600 }.to_json]
        elsif uri.path.start_with?("/v1/tracks/")
          [200, { name: "A track", artists: [{ name: "Some Artist" }], album: { images: [{ url: "https://img/t.jpg" }] } }.to_json]
        end
      end

      LinkImport::Resolver.call("https://open.spotify.com/track/aaa")
      LinkImport::Resolver.call("https://open.spotify.com/track/bbb")
      assert_equal 1, token_calls
    end
  end

  # --- link-in-bio expansion --------------------------------------------------------------------

  test "a Linktree page's outbound https links are expanded, deduplicated and capped at 15" do
    html = <<~HTML
      <html><head><title>My Linktree</title></head><body>
        #{(1..20).map { |n| "<a href='https://example.com/link#{n}'>Link #{n}</a>" }.join}
        <a href="https://example.com/link1">Duplicate</a>
        <a href="mailto:me@example.com">Email</a>
        <a href="https://linktr.ee/s/share">Share</a>
      </body></html>
    HTML

    LinkImport::Resolver.page_fetcher = ->(url) { { status: 200, body: url == "https://linktr.ee/someone" ? html : "<html></html>", content_type: "text/html", final_url: url } }
    LinkPreview.fetcher = ->(_uri) { [200, {}.to_json] }

    result = LinkImport::Resolver.call("https://linktr.ee/someone")
    assert_equal "biolink", result[:kind]
    assert_equal "My Linktree", result[:title]
    assert_equal 15, result[:links].length
    assert result[:links].all? { _1[:url].start_with?("https://example.com/link") }
  end

  test "a link-in-bio page's expanded links never expand a second level" do
    outer = %(<html><head><title>Outer</title></head><body><a href="https://beacons.ai/inner">nested</a></body></html>)
    LinkImport::Resolver.page_fetcher = ->(url) { { status: 200, body: outer, content_type: "text/html", final_url: url } }

    result = LinkImport::Resolver.call("https://linktr.ee/someone")
    nested = result[:links].first
    assert_equal "link", nested[:provider]
    assert_nil nested[:links]
  end

  # --- generic pages ------------------------------------------------------------------------------

  test "an allowlisted generic host is scraped for title, description and og:image" do
    html = <<~HTML
      <html><head>
        <title>Fallback title</title>
        <meta property="og:title" content="Some Band on Bandcamp" />
        <meta property="og:description" content="Independent artist from Mumbai." />
        <meta property="og:image" content="https://img/cover.jpg" />
      </head></html>
    HTML
    LinkImport::Resolver.page_fetcher = ->(_url) { { status: 200, body: html, content_type: "text/html", final_url: "https://someband.bandcamp.com" } }

    result = LinkImport::Resolver.call("https://someband.bandcamp.com")
    assert_equal "page", result[:kind]
    assert_equal "Some Band on Bandcamp", result[:title]
    assert_equal "https://img/cover.jpg", result[:thumbnail]
  end

  test "a non-allowlisted host is never fetched and returns a plain link" do
    fetched = false
    LinkImport::Resolver.page_fetcher = ->(_url) { fetched = true; { status: 200, body: "<html></html>", content_type: "text/html", final_url: "x" } }
    result = LinkImport::Resolver.call("https://random-blog.example/post")
    assert_not fetched
    assert_equal "link", result[:provider]
  end

  test "a person's own website host is scraped even when not on the fixed allowlist" do
    html = "<html><head><title>Riya's site</title></head></html>"
    LinkImport::Resolver.page_fetcher = ->(_url) { { status: 200, body: html, content_type: "text/html", final_url: "https://riyamusic.example" } }
    result = LinkImport::Resolver.call("https://riyamusic.example", own_hosts: ["riyamusic.example"])
    assert_equal "Riya's site", result[:title]
  end

  private

  def with_env(values)
    previous = values.keys.index_with { ENV[_1] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
