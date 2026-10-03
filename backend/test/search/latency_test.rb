require "test_helper"

# R3 latency budget: every search type answers within BUDGET_MS at the scout volume (50k
# profiles, 20k acts, 6k jobs, 30k work samples; /home/user/plan/scout/seed.rb).
#
# Tagged: it runs only when SEARCH_LATENCY_DATABASE_URL points at such a database whose search
# documents are built (SearchIndexBackfillJob), and skips otherwise, so CI without the seed skips
# it. Point it at a copy (createdb -T ml_scout ml_r3_scale), never at a shared database: requests
# write their usual metrics. Run it alone:
#
#   SEARCH_LATENCY_DATABASE_URL=postgres://postgres@localhost:5433/ml_r3_scale \
#     bin/rails test test/search/latency_test.rb
#
# Each query is warmed once, then timed RUNS times in process (routing, controller, SQL, JSON);
# the median must be within budget. The table is printed either way.
class SearchLatencyTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false

  BUDGET_MS = 300
  RUNS = 5
  MIN_PROFILES = 50_000
  # The 15 search scenarios of the architecture review's measurements, then the type-ahead and
  # the unfiltered directory.
  QUERIES = [
    ["talent filters Mumbai/performer/Sufi", "/api/public/talent?location=Mumbai&role=performer&genre=Sufi"],
    ["talent q=tabla player", "/api/public/talent?q=tabla+player"],
    ["all: tabla player mumbai", "/api/search?q=tabla+player+mumbai"],
    ["all: singer", "/api/search?q=singer"],
    ["all: shaadi band", "/api/search?q=shaadi+band"],
    ["talent: singer", "/api/search?q=singer&type=talent"],
    ["all: guitarst (typo)", "/api/search?q=guitarst"],
    ["acts q=sufi city=Delhi", "/api/public/acts?q=sufi&city=Delhi"],
    ["jobs q=drummer location=Pune", "/api/jobs?q=drummer&location=Pune"],
    ["all: dhol", "/api/search?q=dhol"],
    ["all: gayak", "/api/search?q=gayak"],
    ["all: dj in goa", "/api/search?q=dj+in+goa"],
    ["acts: wedding band", "/api/search?q=wedding+band&type=acts"],
    ["samples: qawwali", "/api/search?q=qawwali&type=samples"],
    ["all: vocalst sangeet (typo)", "/api/search?q=vocalst+sangeet"],
    ["suggest: tab", "/api/search/suggest?q=tab"],
    ["talent directory (no query)", "/api/public/talent"]
  ].freeze

  setup do
    url = ENV["SEARCH_LATENCY_DATABASE_URL"]
    skip "set SEARCH_LATENCY_DATABASE_URL to a database seeded at the scout volume" if url.blank?
    @previous = ActiveRecord::Base.connection_db_config
    ActiveRecord::Base.establish_connection(url)
    connection = ActiveRecord::Base.lease_connection
    profiles = connection.select_value("SELECT count(*) FROM profiles").to_i
    skip "the seed is absent (#{profiles} profiles, need #{MIN_PROFILES})" if profiles < MIN_PROFILES
    missing = connection.select_value("SELECT count(*) FROM profiles WHERE search_vector IS NULL").to_i
    skip "search documents not built (#{missing} missing): run SearchIndexBackfillJob first" if missing.positive?
    Search::Spelling.reset!
  end

  teardown do
    ActiveRecord::Base.establish_connection(@previous) if @previous
    Search::Spelling.reset!
  end

  test "every search type answers within the budget at the scout volume" do
    rows = QUERIES.each_with_index.map do |(label, path), index|
      headers = { "REMOTE_ADDR" => "198.51.100.#{index + 1}" }
      get(path, headers:)
      timings = RUNS.times.map do
        started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        get(path, headers:)
        (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000
      end
      assert_response :success, "#{label}: #{response.body.first(200)}"
      [label, timings.sort]
    end
    table = rows.map { |label, ms| format("| %-38s | %6.1f | %6.1f | %6.1f |", label, ms.first, ms[ms.size / 2], ms.last) }
    puts "\n| query | min ms | median ms | max ms |\n|---|---|---|---|\n#{table.join("\n")}"
    slow = rows.select { |_, ms| ms[ms.size / 2] > BUDGET_MS }
    assert_empty slow.map(&:first), "median over #{BUDGET_MS} ms"
  end
end
