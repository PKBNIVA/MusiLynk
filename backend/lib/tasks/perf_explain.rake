# Replays the hottest API requests against a database seeded by `perf:seed`, captures every SELECT
# each request runs, and prints EXPLAIN (ANALYZE, BUFFERS) for it: execution time, rows, and the
# indexes (or sequential scans) the plan used. Development only; see docs/PERFORMANCE.md.
#
#   RAILS_ENV=development DATABASE_URL=postgres://postgres@localhost:5433/ml_perf bin/rails perf:explain
#   Each SELECT is explained REPEAT times (default 5) and the fastest run is reported.
#   PLANS=1 also prints each full text plan; ONLY=inbox limits the run to labels containing "inbox".
# Defined once even when the tasks are loaded again (several tests call load_tasks).
unless defined?(PerfExplain)
  module PerfExplain
    Probe = Data.define(:label, :path, :actor)

    PROBES = [
      ["talent list", "/api/public/talent"], ["talent ?location=Mumbai", "/api/public/talent?location=Mumbai"],
      ["talent ?role=Vocalist", "/api/public/talent?role=Vocalist"], ["talent ?instrument=Tabla", "/api/public/talent?instrument=Tabla"],
      ["talent ?verified=true", "/api/public/talent?verified=true"], ["talent ?remoteRecording=true", "/api/public/talent?remoteRecording=true"],
      ["talent ?language=Tamil", "/api/public/talent?language=Tamil"], ["talent ?eventType=wedding", "/api/public/talent?eventType=wedding"],
      ["talent ?genre=Sufi", "/api/public/talent?genre=Sufi"], ["talent ?budgetMax=20000", "/api/public/talent?budgetMax=20000"],
      ["talent ?q=drummer", "/api/public/talent?q=drummer"], ["talent ?q=sitar+player+kochi", "/api/public/talent?q=sitar+player+kochi"],
      ["search all ?q=guitarist", "/api/search?q=guitarist"], ["search talent", "/api/search?q=guitarist&type=talent"],
      ["search jobs", "/api/search?q=drummer&type=jobs"], ["search acts", "/api/search?q=jazz&type=acts"],
      ["search samples", "/api/search?q=sufi&type=samples"],
      ["acts list", "/api/public/acts"], ["acts ?city=Pune", "/api/public/acts?city=Pune"], ["acts ?genre=Jazz", "/api/public/acts?genre=Jazz"],
      ["acts ?q=band", "/api/public/acts?q=band"],
      ["jobs list", "/api/jobs"], ["jobs ?location=Pune", "/api/jobs?location=Pune"], ["jobs ?q=drummer", "/api/jobs?q=drummer"],
      ["feed", "/api/stage/feed", :jobseeker], ["stage tag", "/api/stage/tags/sufi"],
      ["thread messages", "/api/conversations/conv_perf_0000000/messages", :jobseeker],
      ["inbox (jobseeker)", "/api/conversations", :jobseeker], ["inbox (employer)", "/api/conversations", :employer],
      ["unread count", "/api/notifications/unread", :jobseeker],
      ["public stats", "/api/public/stats"],
      ["profile show", "/api/public/talent/user_perf_0000016"],
      ["bookings list (act owner)", "/api/bookings", :jobseeker], ["bookings list (hirer)", "/api/bookings", :employer],
      ["notifications", "/api/notifications", :jobseeker]
    ].map { Probe.new(*_1.fill(nil, _1.length, 3 - _1.length)) }.freeze

    REPEAT = Integer(ENV.fetch("REPEAT", "5"))

    Row = Data.define(:label, :queries, :db_ms, :slowest_ms, :rows, :indexes, :sql)

    module_function

    def call(out: $stdout)
      abort "perf:explain runs in development only." unless Rails.env.development?
      SearchController.cache_seconds = 0
      Rails.cache.clear
      session = ActionDispatch::Integration::Session.new(Rails.application)
      session.host! "localhost"
      only = ENV["ONLY"].to_s.downcase
      rows = PROBES.select { only.empty? || _1.label.downcase.include?(only) }.map { probe(session, _1, out) }
      rows << urgent_candidates(out) if only.empty? || "urgent candidate scope".include?(only)
      print_table(rows, out)
      rows
    end

    def probe(session, probe, out)
      headers = probe.actor ? { "Authorization" => "Bearer #{PerfSeed::PROBE_TOKENS.fetch(probe.actor)}" } : {}
      session.get(probe.path, headers:) # warm-up: schema, caches
      Rails.cache.clear
      captured = capture { session.get(probe.path, headers:) }
      raise "#{probe.path}: HTTP #{session.response.status} #{session.response.body.first(200)}" unless session.response.status == 200
      explain(probe.label, captured, out)
    end

    # UrgentMatcher's candidate scope runs in a job, not a request: rank one open request in Mumbai.
    def urgent_candidates(out)
      request = UrgentRequest.where(status: "open", city: "Mumbai").order(:id).first!
      explain("urgent candidate scope", capture { UrgentMatcher.call(request) }, out)
    end

    def capture
      queries = []
      callback = lambda do |*, payload|
        next if %w[SCHEMA TRANSACTION].include?(payload[:name]) || !payload[:sql].lstrip.match?(/\A(SELECT|WITH)\b/i)
        binds = payload[:type_casted_binds]
        binds = binds.call if binds.respond_to?(:call)
        queries << [payload[:sql], Array(binds)]
      end
      ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { yield }
      queries
    end

    def explain(label, queries, out)
      connection = ActiveRecord::Base.lease_connection
      plans = queries.map do |sql, binds|
        literal = sql.gsub(/\$(\d+)/) { connection.quote(binds[Regexp.last_match(1).to_i - 1]) }
        # The fastest of REPEAT runs (default 5): a shared machine's noise only ever adds time.
        plan = Array.new(REPEAT) { JSON.parse(connection.select_value("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) #{literal}")).first }.min_by { _1["Execution Time"] }
        [plan["Execution Time"], plan, literal]
      end
      total = plans.sum(&:first)
      ms, slowest, sql = plans.max_by(&:first)
      if ENV["PLANS"]
        out.puts "\n== #{label}: #{sql}"
        out.puts connection.select_values("EXPLAIN (ANALYZE, BUFFERS) #{sql}").join("\n")
      end
      Row.new(label:, queries: queries.size, db_ms: total.round(1), slowest_ms: ms.round(1), rows: slowest.dig("Plan", "Actual Rows"), indexes: access_paths(slowest["Plan"]), sql: sql.first(160))
    end

    # The indexes a plan used, and any sequential scan of a table (with the rows it read).
    def access_paths(node, found = [])
      found << node["Index Name"] if node["Index Name"]
      found << "Seq Scan #{node['Relation Name']}" if node["Node Type"] == "Seq Scan"
      Array(node["Plans"]).each { access_paths(_1, found) }
      found.uniq
    end

    def print_table(rows, out)
      out.puts "\n| Query | Queries | DB ms (all) | Slowest ms | Rows | Access paths (slowest query) |"
      out.puts "| --- | ---: | ---: | ---: | ---: | --- |"
      rows.each do |row|
        out.puts "| #{row.label} | #{row.queries} | #{row.db_ms} | #{row.slowest_ms} | #{row.rows} | #{row.indexes.join(', ').presence || '-'} |"
      end
      return unless ENV["SQL"]
      rows.each { out.puts "#{_1.label}: #{_1.sql}" }
    end
  end
end

namespace :perf do
  desc "EXPLAIN (ANALYZE, BUFFERS) the hottest endpoints' queries against a perf:seed database (development only)."
  task explain: :environment do
    PerfExplain.call
  end
end
