require "net/http"
require "resolv"
require "ipaddr"

# An SSRF-safe fetcher for the public pages LinkImport::Resolver reads (link-in-bio pages,
# bandcamp/apple-music/etc pages, and a person's own website). Never used for a fixed, trusted
# API host (YouTube/Spotify) — those go through their own thin HTTP helpers, the same way
# LinkPreview talks to the oEmbed hosts.
#
# Safety rules, all enforced here rather than trusted to the caller:
# - https only.
# - The hostname is resolved first; every resolved address is checked against the private/
#   loopback/link-local/reserved ranges below (IPv4 and IPv6, including IPv4-mapped IPv6) and the
#   request is refused if any of them match — this closes both "the URL is already a private
#   IP" and "the hostname resolves to one".
# - The TCP connection is made to the resolved (and validated) address, while Host/SNI stay the
#   original hostname (Net::HTTP#ipaddr=) — the address that was actually checked is the address
#   that is actually connected to, not a second, later lookup a DNS server could answer
#   differently for (DNS rebinding).
# - At most 3 redirects are followed, and each hop is re-resolved and re-validated the same way.
# - 5 s connect and read timeouts; the response body is capped at 1 MB; a non-HTML content type
#   is refused without reading the body.
module LinkImport
  class SafeFetch
    class Blocked < StandardError; end

    OPEN_TIMEOUT = 5
    READ_TIMEOUT = 5
    MAX_REDIRECTS = 3
    MAX_BODY_BYTES = 1_048_576
    USER_AGENT = "VerseLinkBot/1.0 (+https://#{ENV.fetch('FRONTEND_URL', 'verse.app').sub(%r{\Ahttps?://}, '')}/about)".freeze

    # Loopback, private, link-local, shared (CGNAT), benchmarking, documentation, multicast and
    # reserved IPv4; and the IPv6 equivalents plus the ranges that embed an IPv4 address
    # (NAT64 64:ff9b::/96, 6to4 2002::/16, Teredo 2001::/32) and so could reach a private one.
    BLOCKED_RANGES = %w[
      0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24
      192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4
      ::/128 ::1/128 64:ff9b::/96 100::/64 2001::/32 2001:db8::/32 2002::/16 fc00::/7 fe80::/10 fec0::/10 ff00::/8
    ].map { IPAddr.new(_1) }.freeze

    # Tests replace this with a stub: ->(host) { ["1.2.3.4"] }.
    class_attribute :resolver, default: ->(host) { Resolv::DNS.open { |dns| dns.getaddresses(host).map { _1.to_s } } }

    # Returns { status:, body:, content_type:, final_url: } or raises Blocked with a reason.
    # `body` is nil (status still set) when the content type is refused before reading.
    def self.call(url, redirects_left: MAX_REDIRECTS)
      uri = validate!(url)
      addr = resolve_and_validate!(uri.host)

      http = Net::HTTP.new(uri.host, uri.port)
      http.ipaddr = addr
      http.use_ssl = true
      http.open_timeout = OPEN_TIMEOUT
      http.read_timeout = READ_TIMEOUT

      request = Net::HTTP::Get.new(uri.request_uri, "accept" => "text/html", "user-agent" => USER_AGENT)
      response = nil
      body = nil
      http.request(request) do |resp|
        response = resp
        location = resp["location"]
        break if resp.is_a?(Net::HTTPRedirection) && location

        content_type = resp.content_type.to_s
        raise Blocked, "refused content type #{content_type}" unless content_type.blank? || content_type.start_with?("text/html")

        body = read_capped_body(resp)
      end

      if response.is_a?(Net::HTTPRedirection) && response["location"]
        raise Blocked, "too many redirects" if redirects_left <= 0
        next_url = URI.join(uri, response["location"]).to_s
        return call(next_url, redirects_left: redirects_left - 1)
      end

      { status: response.code.to_i, body:, content_type: response.content_type.to_s, final_url: uri.to_s }
    rescue URI::InvalidURIError
      raise Blocked, "invalid URL"
    rescue Net::OpenTimeout, Net::ReadTimeout, SocketError, SystemCallError, OpenSSL::SSL::SSLError, IOError, EOFError => e
      raise Blocked, "fetch failed: #{e.class.name}"
    end

    def self.validate!(url)
      uri = URI.parse(url.to_s)
      raise Blocked, "https only" unless uri.scheme&.downcase == "https" && uri.host.present? && uri.userinfo.blank?
      uri
    end

    def self.resolve_and_validate!(host)
      addresses = resolver.call(host)
      raise Blocked, "could not resolve host" if addresses.blank?
      addresses.each { |address| raise Blocked, "address is not publicly routable" if blocked_address?(address) }
      addresses.first
    end

    def self.blocked_address?(address)
      ip = IPAddr.new(address.to_s)
      ip = ip.native if ip.ipv4_mapped?
      BLOCKED_RANGES.any? { |range| range.include?(ip) }
    rescue IPAddr::Error
      true
    end

    def self.read_capped_body(response)
      buffer = +""
      response.read_body do |chunk|
        buffer << chunk
        if buffer.bytesize > MAX_BODY_BYTES
          buffer = buffer.byteslice(0, MAX_BODY_BYTES)
          break
        end
      end
      buffer
    end
  end
end
