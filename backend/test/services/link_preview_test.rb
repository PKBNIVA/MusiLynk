require "test_helper"
require "minitest/mock"

class LinkPreviewTest < ActiveSupport::TestCase
  FakeResponse = Struct.new(:code, :body)

  test "the default fetcher makes one GET to the fixed oEmbed host with 5 s timeouts" do
    http = Minitest::Mock.new
    http.expect(:use_ssl=, true, [true])
    http.expect(:open_timeout=, 5, [5])
    http.expect(:read_timeout=, 5, [5])
    http.expect(:request, FakeResponse.new("200", "{}")) do |request|
      request.is_a?(Net::HTTP::Get) && request.path == "/oembed?url=x&format=json" && request["accept"] == "application/json"
    end
    Net::HTTP.stub(:new, ->(host, port) { assert_equal ["soundcloud.com", 443], [host, port]; http }) do
      assert_equal [200, "{}"], LinkPreview.http_get(URI("https://soundcloud.com/oembed?url=x&format=json"))
    end
    http.verify
  end

  test "providers, kinds and labels" do
    assert_equal "youtube", LinkPreview.provider_for("https://youtu.be/abc")
    assert_equal "soundcloud", LinkPreview.provider_for("https://on.soundcloud.com/x")
    assert_equal "link", LinkPreview.provider_for("https://bandcamp.com/x")
    assert_equal "link", LinkPreview.kind_for("link")
    assert_equal "Link", LinkPreview.label_for("unknown")
  end

  test "clean_text strips markup and caps length; clean_thumbnail keeps only https" do
    assert_equal "#{'a' * 159}…", LinkPreview.clean_text("<p>#{'a' * 300}</p>", 160)
    assert_nil LinkPreview.clean_text("   ", 10)
    assert_nil LinkPreview.clean_thumbnail("javascript:alert(1)")
    assert_nil LinkPreview.clean_thumbnail("https://exa mple.com/x")
    assert_equal "https://i.ytimg.com/a.jpg", LinkPreview.clean_thumbnail("https://i.ytimg.com/a.jpg")
  end
end
