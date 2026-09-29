require "net/http"
require "base64"

# What a pasted link is, extended past LinkPreview's oEmbed-only understanding: a YouTube channel
# or a SoundCloud profile, a Spotify artist/track/album, a link-in-bio page (its outbound links
# expanded one level), or any other allowlisted public page (read for title/description/og/
# JSON-LD). LinkPreview's own API and behaviour are untouched — this sits beside it and defers to
# it for anything it already understands (a YouTube/SoundCloud video, Instagram, a plain link).
#
# YouTube and Spotify need API keys (YOUTUBE_API_KEY, SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET);
# without them a channel/profile/artist/track/album link still resolves, just as a plain link
# with the right `kind` (never an error) — the richer fields are simply absent.
module LinkImport
  class Resolver
    YOUTUBE_HOSTS = %w[youtube.com www.youtube.com m.youtube.com music.youtube.com youtu.be].freeze
    SOUNDCLOUD_HOSTS = %w[soundcloud.com www.soundcloud.com m.soundcloud.com on.soundcloud.com].freeze
    SPOTIFY_HOSTS = %w[open.spotify.com spotify.link].freeze
    SOUNDCLOUD_RESERVED = %w[you discover search upload stream messages settings tags charts].freeze
    MAX_EXPANDED_LINKS = 15
    YOUTUBE_API = "https://www.googleapis.com/youtube/v3".freeze
    SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token".freeze
    SPOTIFY_API = "https://api.spotify.com/v1".freeze
    SPOTIFY_TOKEN_CACHE_KEY = "link-import:spotify-token".freeze

    # (uri, headers: {}, body: nil, method: :get) -> [status_code, response_body_string].
    # Tests replace this with a stub.
    class_attribute :http_client, default: ->(uri, headers: {}, body: nil, method: :get) { Resolver.raw_http(uri, headers:, body:, method:) }
    # (url) -> { status:, body:, content_type:, final_url: } | raises LinkImport::SafeFetch::Blocked.
    class_attribute :page_fetcher, default: ->(url) { SafeFetch.call(url) }

    # `own_hosts`: hosts the caller already knows are the person's own site (profile.website /
    # portfolio_url) — these are scraped as a generic page even when not on the fixed allowlist.
    # `depth`: internal; link-in-bio expansion never recurses past depth 1.
    def self.call(raw, own_hosts: [])
      resolve(raw, own_hosts:, depth: 0)
    end

    def self.resolve(raw, own_hosts:, depth:)
      url = LinkPreview.normalize(raw)
      host = URI.parse(url).host.to_s.downcase

      key = cache_key(url)
      cached = depth.zero? ? Rails.cache.read(key) : nil
      return cached if cached.is_a?(Hash)

      result = if youtube_channel_url?(host, url)
        resolve_youtube_channel(url)
      elsif soundcloud_profile_url?(host, url)
        plain_link(url, "soundcloud", "channel")
      elsif SPOTIFY_HOSTS.include?(host)
        resolve_spotify(url)
      elsif Config.link_in_bio_hosts.include?(host) && depth.zero?
        resolve_link_in_bio(url, own_hosts)
      elsif LinkPreview.provider_for(url) != "link"
        LinkPreview.call(url)
      elsif allowlisted_host?(host, own_hosts)
        resolve_generic(url)
      else
        LinkPreview.call(url)
      end

      result = result.merge(label: LinkPreview.label_for(result[:provider])) if result && !result.key?(:label)
      Rails.cache.write(key, result, expires_in: LinkPreview::CACHE_TTL) if depth.zero? && result
      result
    end

    def self.cache_key(url) = "link-import:v1:#{Digest::SHA256.hexdigest(url)}"

    def self.allowlisted_host?(host, own_hosts)
      Config.allowlisted_hosts.any? { host == _1 || host.end_with?(".#{_1}") } ||
        own_hosts.any? { |own| own.present? && (host == own.downcase || host.end_with?(".#{own.downcase}")) }
    end

    def self.plain_link(url, provider, kind)
      { provider:, kind:, url:, title: nil, author: nil, thumbnail: nil }
    end

    # --- YouTube channel -----------------------------------------------------------------------

    def self.youtube_channel_url?(host, url)
      return false unless YOUTUBE_HOSTS.include?(host)
      path = URI.parse(url).path.to_s
      path.match?(%r{\A/(channel/|@|c/|user/)})
    end

    def self.youtube_api_key = ENV["YOUTUBE_API_KEY"].to_s.strip.presence

    def self.resolve_youtube_channel(url)
      base = { provider: "youtube", kind: "channel", url:, title: nil, author: nil, thumbnail: nil, channel: nil, videos: [] }
      return base unless youtube_api_key

      channel = fetch_youtube_channel(URI.parse(url).path.to_s)
      return base unless channel

      base.merge(title: channel[:title], author: channel[:title], thumbnail: channel[:thumbnail],
        channel:, videos: fetch_youtube_videos(channel[:id]))
    end

    def self.fetch_youtube_channel(path)
      params = case path
        when %r{\A/channel/([\w-]+)} then { id: ::Regexp.last_match(1) }
        when %r{\A/@([\w.\-]+)} then { forHandle: "@#{::Regexp.last_match(1)}" }
        when %r{\A/user/([\w.\-]+)} then { forUsername: ::Regexp.last_match(1) }
        end

      item = youtube_get("channels", (params || {}).merge(part: "snippet"))&.dig("items", 0) if params
      return channel_from_item(item) if item

      slug = path.split("/").last.to_s
      search_item = youtube_get("search", { q: slug, type: "channel", part: "snippet", maxResults: 1 })&.dig("items", 0)
      channel_id = search_item&.dig("snippet", "channelId") || search_item&.dig("id", "channelId")
      return nil unless channel_id

      channel_from_item(youtube_get("channels", { id: channel_id, part: "snippet" })&.dig("items", 0))
    end

    def self.channel_from_item(item)
      return nil unless item
      snippet = item["snippet"] || {}
      { id: item["id"], title: clean(snippet["title"], 160), description: clean(snippet["description"], 600),
        thumbnail: snippet.dig("thumbnails", "high", "url") || snippet.dig("thumbnails", "default", "url") }
    end

    def self.fetch_youtube_videos(channel_id)
      return [] unless channel_id
      items = youtube_get("search", { channelId: channel_id, order: "date", type: "video", part: "snippet", maxResults: 10 })&.dig("items")
      Array(items).first(10).filter_map do |item|
        video_id = item.dig("id", "videoId")
        next unless video_id
        snippet = item["snippet"] || {}
        { title: clean(snippet["title"], 160), thumbnail: snippet.dig("thumbnails", "high", "url") || snippet.dig("thumbnails", "default", "url"),
          url: "https://www.youtube.com/watch?v=#{video_id}" }
      end
    end

    def self.youtube_get(path, params)
      uri = URI.parse("#{YOUTUBE_API}/#{path}")
      uri.query = URI.encode_www_form(params.merge(key: youtube_api_key))
      status, body = http_client.call(uri)
      return nil unless status == 200
      JSON.parse(body.to_s)
    rescue JSON::ParserError, Net::OpenTimeout, Net::ReadTimeout, SocketError, SystemCallError, OpenSSL::SSL::SSLError, IOError
      nil
    end

    # --- SoundCloud profile ---------------------------------------------------------------------

    def self.soundcloud_profile_url?(host, url)
      return false unless SOUNDCLOUD_HOSTS.include?(host)
      segments = URI.parse(url).path.to_s.split("/").reject(&:empty?)
      segments.length == 1 && !SOUNDCLOUD_RESERVED.include?(segments.first)
    end

    # --- Spotify ---------------------------------------------------------------------------------

    def self.spotify_credentials? = ENV["SPOTIFY_CLIENT_ID"].to_s.strip.present? && ENV["SPOTIFY_CLIENT_SECRET"].to_s.strip.present?

    def self.resolve_spotify(url)
      base = { provider: "spotify", kind: "audio", url:, title: nil, author: nil, thumbnail: nil, artist: nil, tracks: [] }
      return base unless spotify_credentials?

      token = spotify_token
      return base unless token

      case URI.parse(url).path.to_s
      when %r{\A/artist/(\w+)} then resolve_spotify_artist(base, ::Regexp.last_match(1), token)
      when %r{\A/track/(\w+)} then resolve_spotify_track(base, ::Regexp.last_match(1), token)
      when %r{\A/album/(\w+)} then resolve_spotify_album(base, ::Regexp.last_match(1), token)
      else base
      end
    end

    def self.resolve_spotify_artist(base, id, token)
      artist = spotify_get("/artists/#{id}", token)
      return base unless artist

      top_tracks = spotify_get("/artists/#{id}/top-tracks", token, market: "IN")
      tracks = Array(top_tracks && top_tracks["tracks"]).first(10).map do
        { title: clean(_1["name"], 160), url: _1.dig("external_urls", "spotify") }
      end
      base.merge(title: clean(artist["name"], 160), thumbnail: artist.dig("images", 0, "url"),
        artist: { name: clean(artist["name"], 160), image: artist.dig("images", 0, "url"),
                  genres: Array(artist["genres"]).first(10).map { clean(_1, 60) },
                  followers: artist.dig("followers", "total") },
        tracks:)
    end

    def self.resolve_spotify_track(base, id, token)
      track = spotify_get("/tracks/#{id}", token)
      return base unless track
      artists = Array(track["artists"]).filter_map { clean(_1["name"], 160) }
      base.merge(title: clean(track["name"], 160), author: artists.join(", "), thumbnail: track.dig("album", "images", 0, "url"))
    end

    def self.resolve_spotify_album(base, id, token)
      album = spotify_get("/albums/#{id}", token)
      return base unless album
      artists = Array(album["artists"]).filter_map { clean(_1["name"], 160) }
      base.merge(title: clean(album["name"], 160), author: artists.join(", "), thumbnail: album.dig("images", 0, "url"))
    end

    def self.spotify_token
      cached = Rails.cache.read(SPOTIFY_TOKEN_CACHE_KEY)
      return cached if cached

      uri = URI.parse(SPOTIFY_TOKEN_URL)
      basic = Base64.strict_encode64("#{ENV['SPOTIFY_CLIENT_ID']}:#{ENV['SPOTIFY_CLIENT_SECRET']}")
      status, body = http_client.call(uri, headers: { "authorization" => "Basic #{basic}", "content-type" => "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials", method: :post)
      return nil unless status == 200

      data = JSON.parse(body.to_s)
      token = data["access_token"]
      return nil unless token

      Rails.cache.write(SPOTIFY_TOKEN_CACHE_KEY, token, expires_in: [data["expires_in"].to_i - 30, 30].max.seconds)
      token
    rescue JSON::ParserError, Net::OpenTimeout, Net::ReadTimeout, SocketError, SystemCallError, OpenSSL::SSL::SSLError, IOError
      nil
    end

    def self.spotify_get(path, token, params = {})
      uri = URI.parse("#{SPOTIFY_API}#{path}")
      uri.query = URI.encode_www_form(params) if params.any?
      status, body = http_client.call(uri, headers: { "authorization" => "Bearer #{token}" })
      return nil unless status == 200
      JSON.parse(body.to_s)
    rescue JSON::ParserError, Net::OpenTimeout, Net::ReadTimeout, SocketError, SystemCallError, OpenSSL::SSL::SSLError, IOError
      nil
    end

    # --- link-in-bio pages -----------------------------------------------------------------------

    def self.resolve_link_in_bio(url, own_hosts)
      base = { provider: "link", kind: "biolink", url:, title: nil, author: nil, thumbnail: nil, links: [] }
      fetched = fetch_page(url)
      return base unless fetched

      meta = HtmlMeta.extract(fetched[:body])
      outbound = HtmlMeta.outbound_links(fetched[:body], fetched[:final_url] || url).first(MAX_EXPANDED_LINKS)
      resolved = outbound.filter_map { |link_url| safely_resolve_nested(link_url, own_hosts) }
      base.merge(title: meta[:title] || meta[:siteName], thumbnail: meta[:image], links: resolved)
    end

    def self.safely_resolve_nested(link_url, own_hosts)
      resolve(link_url, own_hosts:, depth: 1)
    rescue LinkPreview::InvalidUrl, SafeFetch::Blocked
      nil
    end

    # --- generic pages ---------------------------------------------------------------------------

    def self.resolve_generic(url)
      base = { provider: "link", kind: "page", url:, title: nil, author: nil, thumbnail: nil }
      fetched = fetch_page(url)
      return base unless fetched

      meta = HtmlMeta.extract(fetched[:body])
      base.merge(title: meta[:title] || meta[:siteName], author: meta[:personName], thumbnail: meta[:image], description: meta[:description])
    end

    def self.fetch_page(url)
      result = page_fetcher.call(url)
      return nil unless result && result[:status] == 200 && result[:body].present?
      result
    rescue SafeFetch::Blocked
      nil
    end

    def self.clean(value, limit) = LinkPreview.clean_text(value, limit)

    def self.raw_http(uri, headers: {}, body: nil, method: :get)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.open_timeout = 5
      http.read_timeout = 5
      request = method == :post ? Net::HTTP::Post.new(uri.request_uri, headers) : Net::HTTP::Get.new(uri.request_uri, headers)
      request.body = body if body
      response = http.request(request)
      [response.code.to_i, response.body]
    end
  end
end
