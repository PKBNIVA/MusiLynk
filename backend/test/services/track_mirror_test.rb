require "test_helper"
require "minitest/mock"
require "aws-sdk-s3"

# SyntheticQa::TrackMirror: the demo tracks play from the app's own bucket because ccMixter refuses cross-site playback.
# No network: the AWS client runs with stub_responses and the download is a lambda.
class TrackMirrorTest < ActiveSupport::TestCase
  ENV_KEYS = %w[AWS_BUCKET AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION AWS_ENDPOINT_URL_S3 AWS_PUBLIC_BASE_URL].freeze
  MP3 = "ID3\x04\x00\x00\x00\x00\x00\x00".b + ("\x00".b * 20_000)

  setup do
    @saved_env = ENV_KEYS.to_h { [_1, ENV.delete(_1)] }
    @tracks = SyntheticQa::ShowcaseContent.tracks.first(3)
  end

  teardown { ENV_KEYS.each { |name| @saved_env[name].nil? ? ENV.delete(name) : ENV[name] = @saved_env[name] } }

  test "without a bucket the samples keep the ccMixter link and nothing is copied" do
    assert_not SyntheticQa::TrackMirror.enabled?
    assert_equal @tracks.first.fetch("url"), SyntheticQa::TrackMirror.url_for(@tracks.first)
    assert_equal 0, SyntheticQa::TrackMirror.mirror!(@tracks, fetcher: ->(_url) { flunk "must not download" })
  end

  test "with a bucket every missing track is copied once, as audio/mpeg with a long cache lifetime" do
    with_bucket do |client|
      client.stub_responses(:head_object, ->(context) { context.params[:key].end_with?("/#{@tracks[1].fetch('id')}.mp3") ? { content_length: MP3.bytesize } : "NotFound" })
      put = []
      client.stub_responses(:put_object, ->(context) { put << context.params.slice(:key, :content_type, :cache_control) && {} })
      downloaded = []
      assert_equal 2, SyntheticQa::TrackMirror.mirror!(@tracks, fetcher: ->(url) { downloaded << url && MP3 })

      assert_equal [@tracks[0], @tracks[2]].map { _1.fetch("url") }, downloaded
      assert_equal [@tracks[0], @tracks[2]].map { "demo/showcase/#{_1.fetch('id')}.mp3" }, put.map { _1.fetch(:key) }
      assert_equal ["audio/mpeg"], put.map { _1.fetch(:content_type) }.uniq
      assert_match(/immutable/, put.first.fetch(:cache_control))
      assert_equal "https://media.verse.test/demo/showcase/#{@tracks[0].fetch('id')}.mp3", SyntheticQa::TrackMirror.url_for(@tracks[0])
    end
  end

  test "a track that cannot be downloaded stops the run with a readable error" do
    with_bucket do |client|
      client.stub_responses(:head_object, "NotFound")
      error = assert_raises(SyntheticQa::TrackMirror::Error) do
        SyntheticQa::TrackMirror.mirror!(@tracks, fetcher: ->(_url) { raise SyntheticQa::TrackMirror::Error, "ccMixter answered 403." })
      end
      assert_match(/403/, error.message)
    end
  end

  test "download refuses anything but a ccMixter HTTPS link and anything that is not an MP3" do
    assert_raises(SyntheticQa::TrackMirror::Error) { SyntheticQa::TrackMirror.download("https://example.com/a.mp3") }
    assert_raises(SyntheticQa::TrackMirror::Error) { SyntheticQa::TrackMirror.download("http://ccmixter.org/content/a.mp3") }
  end

  test "download sends the ccMixter Referer and returns the MP3 bytes" do
    seen = []
    with_http(body: MP3, seen:) { assert_equal MP3, SyntheticQa::TrackMirror.download("https://ccmixter.org/content/a/a.mp3") }
    assert_equal ["https://ccmixter.org/"], seen
  end

  test "download rejects an HTML error page and a non-200 answer" do
    with_http(body: "<html>Forbidden</html>" * 1000) { assert_raises(SyntheticQa::TrackMirror::Error) { SyntheticQa::TrackMirror.download("https://ccmixter.org/content/a/a.mp3") } }
    with_http(body: "", code: "403", klass: Net::HTTPForbidden) do
      error = assert_raises(SyntheticQa::TrackMirror::Error) { SyntheticQa::TrackMirror.download("https://ccmixter.org/content/a/a.mp3") }
      assert_match(/403/, error.message)
    end
  end

  private

  def with_http(body:, code: "200", klass: Net::HTTPOK, seen: [])
    response = klass.new("1.1", code, "")
    response.instance_variable_set(:@read, true)
    response.instance_variable_set(:@body, body)
    http = Object.new
    http.define_singleton_method(:request) { |request| seen << request["Referer"] && response }
    Net::HTTP.stub(:start, ->(*_args, **_options, &block) { block.call(http) }) { yield }
  end

  def with_bucket
    ENV.update("AWS_BUCKET" => "verse-test", "AWS_ACCESS_KEY_ID" => "id", "AWS_SECRET_ACCESS_KEY" => "secret", "AWS_REGION" => "auto",
      "AWS_ENDPOINT_URL_S3" => "https://acct.r2.cloudflarestorage.com", "AWS_PUBLIC_BASE_URL" => "https://media.verse.test")
    client = Aws::S3::Client.new(stub_responses: true, region: "auto")
    UploadStorage.stub(:client, client) { yield client }
  end
end
