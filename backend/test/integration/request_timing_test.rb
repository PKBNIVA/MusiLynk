require "test_helper"

# Every API response carries a Server-Timing header and logs one JSON line with total and
# database time, so slow endpoints are visible in Railway logs and browser dev tools.
class RequestTimingTest < ActionDispatch::IntegrationTest
  setup do
    employer = User.create!(name: "Timing Employer", email: "timing-emp@example.com", password: "VerseStagePass1!", role: "employer", status: "active")
    Job.create!(employer:, title: "Timing Session Drummer", company: "Timing Co", location: "Mumbai", kind: "Contract",
      opportunity_kind: "gig", workplace: "onsite", genre: "Live", skills: ["Drums"],
      description: "A clearly documented paid studio session with written terms and a two-hour call.", status: "published", published_at: Time.current)
  end

  test "responses carry Server-Timing with database time, query count and total time" do
    get "/api/jobs"
    assert_response :success
    header = response.headers["Server-Timing"]
    assert_match(/\Adb;dur=\d+(\.\d+)?;desc="(\d+) queries", app;dur=\d+(\.\d+)?\z/, header)
    assert_operator header[/desc="(\d+) queries"/, 1].to_i, :>, 0, "the job listing runs SQL"
  end

  test "error responses carry Server-Timing too" do
    get "/api/jobs/999999999"
    assert_response :not_found
    assert_match(/\Adb;dur=.*, app;dur=/, response.headers["Server-Timing"])
  end

  test "each request logs one JSON line with route, status, duration, db time and query count" do
    lines = capture_request_log { get "/api/jobs" }
    assert_equal 1, lines.size
    entry = lines.first[:entry]
    assert_equal :info, lines.first[:level]
    assert_equal "jobs#index", entry["route"]
    assert_equal 200, entry["status"]
    assert_kind_of Numeric, entry["durationMs"]
    assert_kind_of Numeric, entry["dbMs"]
    assert_operator entry["dbQueries"], :>, 0
    assert_operator entry["dbMs"], :<=, entry["durationMs"]
    refute entry.key?("slow")
  end

  test "requests over the slow threshold are logged at warn level with slow: true" do
    previous = ApplicationController.slow_request_ms
    ApplicationController.slow_request_ms = 0
    lines = capture_request_log { get "/api/jobs" }
    assert_equal :warn, lines.first[:level]
    assert_equal true, lines.first[:entry]["slow"]
  ensure
    ApplicationController.slow_request_ms = previous
  end

  private

  def capture_request_log
    io = StringIO.new
    sink = ActiveSupport::Logger.new(io)
    sink.formatter = ->(severity, _time, _progname, message) { "#{severity.downcase}\t#{message}\n" }
    Rails.logger.broadcast_to(sink)
    yield
    io.string.lines.filter_map do |line|
      level, message = line.chomp.split("\t", 2)
      entry = JSON.parse(message.to_s) rescue next
      { level: level.to_sym, entry: } if entry.is_a?(Hash) && entry["event"] == "http_request"
    end
  ensure
    Rails.logger.stop_broadcasting_to(sink)
  end
end
