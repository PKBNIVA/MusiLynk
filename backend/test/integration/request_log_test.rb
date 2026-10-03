require "test_helper"
require "minitest/mock"
require_relative "../support/sentry_test_support"

# The one JSON line each request writes (RequestLog via lograge), the request id that ties it to
# the edge, the client and Sentry (EdgeRequestId), and what must never appear in it.
class RequestLogTest < ActionDispatch::IntegrationTest
  include SentryTestSupport

  setup do
    @employer = User.create!(name: "Log Employer Priya", email: "log-priya@example.com", password: "MusilynkStagePass1!", role: "employer", status: "active")
    @job = Job.create!(employer: @employer, title: "Log Session Drummer", company: "Log Co", location: "Mumbai", kind: "Contract",
      opportunity_kind: "gig", workplace: "onsite", genre: "Live", skills: ["Drums"],
      description: "A clearly documented paid studio session with written terms and a two-hour call.", status: "published", published_at: Time.current)
  end

  test "each request logs exactly one JSON line with method, path, route, status, duration, db, view, request id and query count" do
    lines = capture_request_log { get "/api/jobs?q=drummer&location=Mumbai" }
    assert_equal 1, lines.size
    entry = lines.first[:entry]
    assert_equal "GET", entry["method"]
    assert_equal "/api/jobs", entry["path"], "the route pattern: no query string, no ids"
    assert_equal %w[JobsController index], entry.values_at("controller", "action")
    assert_equal 200, entry["status"]
    assert_kind_of Numeric, entry["duration"]
    assert_kind_of Numeric, entry["db"]
    assert_kind_of Numeric, entry["view"]
    assert_operator entry["dbQueries"], :>, 0
    assert_equal response.headers["X-Request-Id"], entry["requestId"]
    assert_match(/\A[\w\-@]+\z/, entry["requestId"])
    refute entry.key?("slow")
    refute entry.key?("userHash"), "anonymous requests carry no user hash"
    refute entry.key?("params")
    refute entry.key?("format")
  end

  test "path is the route pattern, so ids and public handles in the URL never reach the log" do
    [
      ["/api/public/talent/#{@employer.id}", "/api/public/talent/:id"],
      ["/api/public/talent/user_0d9c1a2b-1111-4222-8333-444455556666", "/api/public/talent/:id"],
      ["/api/public/acts/act_0d9c1a2b-1111-4222-8333-444455556666", "/api/public/acts/:id"],
      ["/api/public/portfolios/priya-k-drums", "/api/public/portfolios/:slug"],
      ["/share/p/priya-k-drums", "/share/p/:slug"],
      ["/api/stage/authors/user/#{@employer.id}", "/api/stage/authors/:type/:id"],
      ["/api/stage/authors/user/#{@employer.id}/posts", "/api/stage/authors/:type/:authorId/posts"],
      ["/share-cards/verified/#{@employer.id}.svg", "/share-cards/verified/:user_id"],
      ["/api/acts/act_0d9c1a2b-1111-4222-8333-444455556666/members/mem_0d9c1a2b-1111-4222-8333-444455556666", "/api/acts/:id/members/:member_id"]
    ].each do |url, pattern|
      lines = capture_request_log { url.include?("/members/") ? delete(url, headers: auth(@employer)) : get(url) }
      assert_equal 1, lines.size, url
      assert_equal pattern, lines.first[:entry]["path"], url
      refute_includes lines.first[:raw], @employer.id, url
      refute_includes lines.first[:raw], "priya-k-drums", url
      refute_includes lines.first[:raw], "0d9c1a2b", url
    end
  end

  test "the path mask also covers a raw path without a route pattern" do
    request = Struct.new(:route_uri_pattern, :path).new(nil, "/api/things/user_0d9c1a2b-1111-4222-8333-444455556666/parts/42/x")
    assert_equal "/api/things/:id/parts/:id/x", RequestLog.route_pattern(request)
    assert_equal "/api/jobs", RequestLog.route_pattern(Struct.new(:route_uri_pattern, :path).new("/api/jobs(.:format)", "/api/jobs?x"))
  end

  test "a session presented by a different browser family logs a user hash, not the id" do
    raw = SecureRandom.urlsafe_base64(48)
    @employer.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now,
      client_fingerprint: Session.fingerprint("Mozilla/5.0 (Macintosh) AppleWebKit/605 Safari/605"))
    io = StringIO.new
    sink = ActiveSupport::Logger.new(io)
    Rails.logger.broadcast_to(sink)
    get "/api/me", headers: { "Authorization" => "Bearer #{raw}", "User-Agent" => "Mozilla/5.0 (Windows) Chrome/130" }
    Rails.logger.stop_broadcasting_to(sink)
    line = io.string.lines.find { _1.include?('"event":"session_client_mismatch"') }
    assert line, "expected the mismatch to be logged"
    assert_includes line, RequestLog.user_hash(@employer.id)
    refute_includes line, @employer.id
    refute_includes line, "userId"
  end

  test "a signed-in request carries a keyed hash of the user id, never the id, email or name" do
    lines = capture_request_log { get "/api/me", headers: auth(@employer) }
    entry = lines.first[:entry]
    assert_equal 200, entry["status"]
    hash = entry.fetch("userHash")
    assert_match(/\A[0-9a-f]{16}\z/, hash)
    assert_equal RequestLog.user_hash(@employer.id), hash, "stable, so one person's requests correlate"
    raw = lines.first[:raw]
    refute_includes raw, @employer.id
    refute_includes raw, "log-priya"
    refute_includes raw, "Priya"
    refute_includes raw, "Bearer"
    refute_match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+\.[A-Za-z]{2,}/, raw, "no email address")
  end

  test "the user hash is keyed: it is not a plain digest of the id" do
    id = @employer.id
    hash = RequestLog.user_hash(id)
    refute_equal Digest::SHA256.hexdigest(id).first(16), hash
    refute_equal Digest::MD5.hexdigest(id).first(16), hash
    assert_equal hash, RequestLog.user_hash(id)
    refute_equal hash, RequestLog.user_hash("someone-else")
  end

  test "request parameters and bodies never reach the log line" do
    raw = capture_request_log do
      post "/api/auth/login", params: { email: "log-priya@example.com", password: "MusilynkStagePass1!" }, as: :json
    end.first[:raw]
    refute_includes raw, "log-priya"
    refute_includes raw, "MusilynkStagePass1"
    refute_includes raw, "password"
  end

  test "requests at or over the slow threshold are flagged slow: true" do
    previous = ApplicationController.slow_request_ms
    ApplicationController.slow_request_ms = 0
    lines = capture_request_log { get "/api/jobs" }
    assert_equal true, lines.first[:entry]["slow"]
  ensure
    ApplicationController.slow_request_ms = previous
  end

  test "an unhandled exception logs the status and the exception class only, not its message" do
    ReadinessChecks.stub(:new, -> { raise "readiness exploded for alert-admin@example.com" }) do
      lines = capture_request_log do
        get "/api/readiness"
      rescue RuntimeError
        # Test environments may re-raise instead of rendering the 500; the line is written either way.
      end
      entry = lines.first[:entry]
      assert_equal 500, entry["status"]
      assert_equal "RuntimeError", entry["error"]
      refute_includes lines.first[:raw], "alert-admin"
    end
  end

  test "the formatter keeps a namespaced exception class and drops the message" do
    line = JSON.parse(RequestLog.format(status: 500, error: "ActiveRecord::StatementInvalid: PG::UndefinedColumn: ERROR: column users.secret for priya@example.com"))
    assert_equal "ActiveRecord::StatementInvalid", line["error"]
    refute_includes line.to_json, "priya"
    assert_equal "RuntimeError", JSON.parse(RequestLog.format(error: "RuntimeError: boom"))["error"]
    assert_equal "Stage::PostsController::Refused", JSON.parse(RequestLog.format(error: "Stage::PostsController::Refused"))["error"]
  end

  test "an X-Request-Id from the client is kept, echoed back and logged" do
    lines = capture_request_log { get "/api/jobs", headers: { "X-Request-Id" => "client-abc-123" } }
    assert_equal "client-abc-123", response.headers["X-Request-Id"]
    assert_equal "client-abc-123", lines.first[:entry]["requestId"]
  end

  test "a request that came through Vercel keeps the edge id as its request id" do
    lines = capture_request_log { get "/api/public/stats", headers: { "X-Vercel-Id" => "bom1::sfo1::k7h2x-1759500000000-9f1a2b3c4d5e" } }
    expected = "bom1-sfo1-k7h2x-1759500000000-9f1a2b3c4d5e"
    assert_equal expected, response.headers["X-Request-Id"]
    assert_equal expected, lines.first[:entry]["requestId"]
  end

  test "an explicit X-Request-Id wins over the edge id, and an edge id with junk is normalised" do
    get "/api/public/stats", headers: { "X-Request-Id" => "mine-1", "X-Vercel-Id" => "bom1::other" }
    assert_equal "mine-1", response.headers["X-Request-Id"]
    assert_equal "a-b-c_d@escript", EdgeRequestId.normalize(" a::b/c_d@e<script> "), "only word characters, - and @ survive"
    assert_equal 255, EdgeRequestId.normalize("x" * 400).length
  end

  test "a reported error carries the request id as a tag" do
    with_sentry do
      ReadinessChecks.stub(:new, -> { raise "readiness exploded" }) do
        begin
          get "/api/readiness", headers: { "X-Request-Id" => "traced-req-9" }
        rescue RuntimeError
          nil
        end
      end
      payload = sentry_payloads.find { _1["exception"] }
      assert payload, "expected the 500 to be reported"
      assert_equal "traced-req-9", payload.dig("tags", "request_id")
    end
  end

  test "the request line is on (only development may opt out with LOGRAGE=false)" do
    assert Rails.application.config.lograge.enabled
    source = File.read(Rails.root.join("config/initializers/lograge.rb"))
    assert_match(/config\.lograge\.enabled = !\(Rails\.env\.development\? && ENV\["LOGRAGE"\] == "false"\)/, source)
    assert_equal [ActionController::API], Array(Rails.application.config.lograge.base_controller_class).map { _1.is_a?(String) ? _1.constantize : _1 }
  end

  test "the Server-Timing header is still sent" do
    get "/api/jobs"
    assert_match(/\Adb;dur=\d+(\.\d+)?;desc="(\d+) queries", app;dur=\d+(\.\d+)?\z/, response.headers["Server-Timing"])
  end

  private

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end

  def capture_request_log
    io = StringIO.new
    sink = ActiveSupport::Logger.new(io)
    sink.formatter = ->(severity, _time, _progname, message) { "#{severity.downcase}\t#{message}\n" }
    Rails.logger.broadcast_to(sink)
    yield
    io.string.lines.filter_map do |line|
      level, message = line.chomp.split("\t", 2)
      entry = JSON.parse(message.to_s) rescue next
      { level: level.to_sym, entry:, raw: message } if entry.is_a?(Hash) && entry["event"] == RequestLog::EVENT
    end
  ensure
    Rails.logger.stop_broadcasting_to(sink)
  end
end
