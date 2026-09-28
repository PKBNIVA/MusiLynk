require "net/http"

# What a pasted work link is, for the two-minute sign-up and the portfolio: which service it is
# on, its title, the channel or artist, and a thumbnail.
#
# YouTube and SoundCloud answer keyless oEmbed requests; Instagram and Spotify need API keys we
# don't have, so for them only the service and the link are returned. Any other https link is
# a plain "link". Only fixed oEmbed hosts are ever contacted (the pasted URL is a query
# parameter), so a preview can never be used to reach an arbitrary address.
#
# oEmbed answers are untrusted: their `html` is ignored, and only the title, author and an https
# thumbnail are kept, stripped of markup and length-capped.
class LinkPreview
  class InvalidUrl < StandardError; end

  OPEN_TIMEOUT = 5
  READ_TIMEOUT = 5
  CACHE_TTL = 24.hours
  MAX_URL_LENGTH = 2_000
  TITLE_LIMIT = 160
  AUTHOR_LIMIT = 120
  THUMBNAIL_LIMIT = 500
  PROVIDERS = {
    "youtube" => { hosts: %w[youtube.com www.youtube.com m.youtube.com music.youtube.com youtu.be], kind: "video",
                   oembed: "https://www.youtube.com/oembed" },
    "soundcloud" => { hosts: %w[soundcloud.com www.soundcloud.com m.soundcloud.com on.soundcloud.com], kind: "audio",
                      oembed: "https://soundcloud.com/oembed" },
    "instagram" => { hosts: %w[instagram.com www.instagram.com], kind: "video" },
    "spotify" => { hosts: %w[open.spotify.com spotify.link], kind: "audio" }
  }.freeze
  LABELS = { "youtube" => "YouTube", "soundcloud" => "SoundCloud", "instagram" => "Instagram", "spotify" => "Spotify", "link" => "Link" }.freeze

  # Tests replace this with a stub: ->(uri) { [status, body] }.
  class_attribute :fetcher, default: ->(uri) { LinkPreview.http_get(uri) }

  # The cleaned https URL, or raises InvalidUrl with a message for the person.
  def self.normalize(raw)
    value = raw.to_s.strip
    raise InvalidUrl, "Paste a link to your work." if value.empty?
    raise InvalidUrl, "That link is too long." if value.length > MAX_URL_LENGTH
    uri = URI.parse(value)
    raise InvalidUrl, "Use a link that starts with https://" unless uri.scheme&.downcase == "https" && uri.host.present? && uri.userinfo.blank?
    uri.to_s
  rescue URI::InvalidURIError
    raise InvalidUrl, "That doesn't look like a web link."
  end

  def self.provider_for(url)
    host = URI.parse(url).host.to_s.downcase
    PROVIDERS.find { |_name, config| config[:hosts].include?(host) }&.first || "link"
  end

  def self.kind_for(provider) = PROVIDERS.dig(provider, :kind) || "link"

  def self.label_for(provider) = LABELS.fetch(provider, "Link")

  # { provider:, kind:, url:, title:, author:, thumbnail: } for a URL; raises InvalidUrl.
  def self.call(raw)
    url = normalize(raw)
    provider = provider_for(url)
    base = { provider:, kind: kind_for(provider), url:, title: nil, author: nil, thumbnail: nil }
    endpoint = PROVIDERS.dig(provider, :oembed)
    return base unless endpoint

    key = cache_key(url)
    cached = Rails.cache.read(key)
    return cached if cached.is_a?(Hash)

    details = fetch_oembed(endpoint, url)
    return base unless details
    result = base.merge(details)
    Rails.cache.write(key, result, expires_in: CACHE_TTL)
    result
  end

  # A cached preview only, never a network call: used while creating an account, which must not
  # wait on YouTube.
  def self.cached(url)
    value = Rails.cache.read(cache_key(url))
    value.is_a?(Hash) ? value : nil
  end

  def self.cache_key(url) = "link-preview:v1:#{Digest::SHA256.hexdigest(url)}"

  def self.fetch_oembed(endpoint, url)
    uri = URI.parse(endpoint)
    uri.query = URI.encode_www_form(url:, format: "json")
    status, body = fetcher.call(uri)
    return nil unless status == 200
    data = JSON.parse(body.to_s)
    return nil unless data.is_a?(Hash)
    { title: clean_text(data["title"], TITLE_LIMIT), author: clean_text(data["author_name"], AUTHOR_LIMIT), thumbnail: clean_thumbnail(data["thumbnail_url"]) }
  rescue JSON::ParserError, Net::OpenTimeout, Net::ReadTimeout, SocketError, SystemCallError, OpenSSL::SSL::SSLError, IOError => error
    Rails.logger.warn({ event: "link_preview_failed", host: uri&.host, error: error.class.name }.to_json)
    nil
  end

  def self.clean_text(value, limit)
    return nil unless value.is_a?(String)
    text = sanitizer.sanitize(value).to_s.squish
    text.presence&.truncate(limit, omission: "…")
  end

  def self.clean_thumbnail(value)
    return nil unless value.is_a?(String) && value.length <= THUMBNAIL_LIMIT
    uri = URI.parse(value)
    uri.scheme == "https" && uri.host.present? && uri.userinfo.blank? ? uri.to_s : nil
  rescue URI::InvalidURIError
    nil
  end

  def self.sanitizer = (@sanitizer ||= Rails::Html::FullSanitizer.new)

  def self.http_get(uri)
    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = OPEN_TIMEOUT
    http.read_timeout = READ_TIMEOUT
    response = http.request(Net::HTTP::Get.new(uri.request_uri, "accept" => "application/json"))
    [response.code.to_i, response.body]
  end
end
