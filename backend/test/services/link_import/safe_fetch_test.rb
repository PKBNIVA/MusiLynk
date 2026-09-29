require "test_helper"
require "minitest/mock"

class LinkImport::SafeFetchTest < ActiveSupport::TestCase
  test "refuses non-https URLs" do
    assert_raises(LinkImport::SafeFetch::Blocked) { LinkImport::SafeFetch.call("http://example.com") }
  end

  test "refuses a URL with userinfo" do
    assert_raises(LinkImport::SafeFetch::Blocked) { LinkImport::SafeFetch.call("https://user:pass@example.com") }
  end

  test "refuses when DNS resolves to nothing" do
    with_resolver(->(_host) { [] }) do
      assert_raises(LinkImport::SafeFetch::Blocked) { LinkImport::SafeFetch.call("https://nowhere.example") }
    end
  end

  test "refuses every private/loopback/link-local/reserved range, IPv4 and IPv6" do
    blocked = %w[127.0.0.1 10.1.2.3 172.16.0.5 192.168.1.1 169.254.1.1 0.1.2.3 100.64.0.1 ::1 fc00::1 fe80::1 ::ffff:127.0.0.1]
    blocked.each { |address| assert LinkImport::SafeFetch.blocked_address?(address), "expected #{address} to be blocked" }
  end

  test "allows an ordinary public address" do
    assert_not LinkImport::SafeFetch.blocked_address?("93.184.216.34")
    assert_not LinkImport::SafeFetch.blocked_address?("2606:2800:220:1:248:1893:25c8:1946")
  end

  test "refuses a URL whose host resolves to a private address" do
    with_resolver(->(_host) { ["10.0.0.5"] }) do
      assert_raises(LinkImport::SafeFetch::Blocked) { LinkImport::SafeFetch.call("https://internal.example") }
    end
  end

  test "refuses a non-HTML content type without reading the body" do
    with_resolver(->(_host) { ["93.184.216.34"] }) do
      read = false
      with_fake_http("safe.example" => fake_response(content_type: "application/pdf") { read = true }) do
        assert_raises(LinkImport::SafeFetch::Blocked) { LinkImport::SafeFetch.call("https://safe.example/file.pdf") }
      end
      assert_not read
    end
  end

  test "caps the body at 1 MB" do
    with_resolver(->(_host) { ["93.184.216.34"] }) do
      big_chunk = "a" * 2_000_000
      with_fake_http("safe.example" => fake_response(content_type: "text/html", body: big_chunk)) do
        result = LinkImport::SafeFetch.call("https://safe.example/big")
        assert_equal LinkImport::SafeFetch::MAX_BODY_BYTES, result[:body].bytesize
      end
    end
  end

  test "follows up to 3 redirects, re-validating each hop, and refuses a fourth" do
    with_resolver(->(_host) { ["93.184.216.34"] }) do
      responses = {
        "hop0.example" => fake_response(redirect_to: "https://hop1.example/"),
        "hop1.example" => fake_response(redirect_to: "https://hop2.example/"),
        "hop2.example" => fake_response(redirect_to: "https://hop3.example/"),
        "hop3.example" => fake_response(redirect_to: "https://hop4.example/")
      }
      with_fake_http(responses) do
        assert_raises(LinkImport::SafeFetch::Blocked) { LinkImport::SafeFetch.call("https://hop0.example/") }
      end
    end
  end

  test "a redirect to a private address is refused" do
    resolutions = { "a.example" => ["93.184.216.34"], "internal.example" => ["127.0.0.1"] }
    with_resolver(->(host) { resolutions.fetch(host, []) }) do
      with_fake_http("a.example" => fake_response(redirect_to: "https://internal.example/x")) do
        assert_raises(LinkImport::SafeFetch::Blocked) { LinkImport::SafeFetch.call("https://a.example/start") }
      end
    end
  end

  test "a successful fetch returns status, body and content type" do
    with_resolver(->(_host) { ["93.184.216.34"] }) do
      with_fake_http("safe.example" => fake_response(content_type: "text/html", body: "<html><title>hi</title></html>")) do
        result = LinkImport::SafeFetch.call("https://safe.example/page")
        assert_equal 200, result[:status]
        assert_equal "<html><title>hi</title></html>", result[:body]
        assert_equal "text/html", result[:content_type]
      end
    end
  end

  private

  def with_resolver(resolver)
    original = LinkImport::SafeFetch.resolver
    LinkImport::SafeFetch.resolver = resolver
    yield
  ensure
    LinkImport::SafeFetch.resolver = original
  end

  # A fake Net::HTTP response: either a redirect (301 + Location) or a 200 with a body streamed
  # through read_body, exactly like the real thing SafeFetch#call reads.
  def fake_response(content_type: nil, body: "", redirect_to: nil, &on_read)
    Struct.new(:redirect_to, :content_type, :body) do
      def code = redirect_to ? "301" : "200"
      def [](key) = key == "location" ? redirect_to : nil
      def is_a?(klass) = klass == Net::HTTPRedirection ? !!redirect_to : super
      define_method(:read_body) { |&blk| blk.call(body) }
    end.new(redirect_to, content_type, body).tap { |r| r.define_singleton_method(:read_body) { |&blk| on_read&.call; blk.call(body) } if on_read }
  end

  # Routes Net::HTTP.new(host, port) to a fake http object per host, so SafeFetch's real
  # connection/request/redirect logic runs unchanged against canned responses.
  def with_fake_http(responses_by_host)
    Net::HTTP.stub(:new, lambda { |host, _port|
      fake = Object.new
      fake.define_singleton_method(:use_ssl=) { |_| }
      fake.define_singleton_method(:open_timeout=) { |_| }
      fake.define_singleton_method(:read_timeout=) { |_| }
      fake.define_singleton_method(:ipaddr=) { |_| }
      fake.define_singleton_method(:request) { |_req, &blk| blk.call(responses_by_host.fetch(host)) }
      fake
    }) { yield }
  end
end
