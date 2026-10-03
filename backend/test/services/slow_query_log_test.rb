require "test_helper"

# Slow SQL is logged by shape only: SqlFingerprint replaces every literal, so a statement that
# carried an email, a name or a message body never puts it in the logs.
class SlowQueryLogTest < ActiveSupport::TestCase
  test "fingerprints replace strings, numbers and lists with placeholders and keep the shape" do
    sql = %(SELECT "users".* FROM "users" WHERE "users"."email" = 'priya.k@example.com' AND "users"."status" = 'active' AND id IN ('a1', 'b2', 'c3') ORDER BY created_at DESC LIMIT 1 OFFSET 20)
    assert_equal %(SELECT "users".* FROM "users" WHERE "users"."email" = ? AND "users"."status" = ? AND id IN (?) ORDER BY created_at DESC LIMIT ? OFFSET ?),
      SqlFingerprint.call(sql)
  end

  test "fingerprints normalise bind placeholders, keep identifiers, and handle quotes inside strings, E and dollar quoting" do
    assert_equal %(SELECT * FROM jobs WHERE title = ? AND location = ? AND id IN (?)), SqlFingerprint.call(%(SELECT * FROM jobs WHERE title = $1 AND location = $2 AND id IN ($3, $4, $5)))
    assert_equal %(UPDATE posts SET body = ? WHERE id = ?), SqlFingerprint.call(%(UPDATE posts SET body = 'it''s a ''quoted'' body with an@email.test' WHERE id = 42))
    assert_equal %(SELECT ? , ?), SqlFingerprint.call(%(SELECT E'esc\\'aped' , $tag$ dollar 'quoted' 7 $tag$))
    assert_equal %(SELECT t1.col2 FROM table_3 t1 WHERE x = ?), SqlFingerprint.call(%(SELECT t1.col2 FROM table_3 t1 WHERE x = 3.5e10))
    assert_equal %(SELECT * FROM a WHERE b = ?), SqlFingerprint.call(%(SELECT * FROM a /* request:abc */ WHERE b = -7 -- trailing note 'x'))
  end

  test "fingerprints are bounded in length and squash whitespace" do
    long = "SELECT * FROM t WHERE #{(1..2_000).map { "c#{_1} = #{_1}" }.join(' AND ')}"
    print = SqlFingerprint.call(long)
    assert_operator print.length, :<=, SqlFingerprint::MAX_LENGTH
    assert_equal "SELECT a , b FROM t", SqlFingerprint.call("SELECT   a ,\n\n b\tFROM t  ")
  end

  test "the subscriber logs slow statements as one JSON line with the fingerprint and no literal values" do
    io = StringIO.new
    logger = ActiveSupport::Logger.new(io)
    subscriber = SlowQueryLog.subscribe(threshold_ms: 0, logger:)
    begin
      User.where(email: "slow-log-victim@example.com", name: "Slow Log Victim").where("users.id IN (?)", %w[one two]).limit(3).to_a
    ensure
      ActiveSupport::Notifications.unsubscribe(subscriber)
    end
    lines = io.string.lines.map { JSON.parse(_1.sub(/\A[A-Z]?,?\s*\[?[^\{]*/, "")) }
    line = lines.find { _1["sql"].include?('FROM "users"') }
    assert line, "expected the users query to be logged: #{io.string}"
    assert_equal SlowQueryLog::EVENT, line["event"]
    assert_equal "User Load", line["name"]
    assert_kind_of Numeric, line["durationMs"]
    assert_includes line["sql"], '"users"."email" = ?'
    assert_includes line["sql"], "IN (?)"
    assert_includes line["sql"], "LIMIT ?"
    refute_includes io.string, "slow-log-victim"
    refute_includes io.string, "Slow Log Victim"
    refute_includes io.string, "'one'"
  end

  test "the subscriber ignores fast statements and schema queries" do
    io = StringIO.new
    subscriber = SlowQueryLog.subscribe(threshold_ms: 10_000, logger: ActiveSupport::Logger.new(io))
    begin
      User.where(email: "fast@example.com").to_a
    ensure
      ActiveSupport::Notifications.unsubscribe(subscriber)
    end
    assert_empty io.string
    schema = ActiveSupport::Notifications::Event.new("sql.active_record", Time.now, Time.now + 1, "id", { name: "SCHEMA", sql: "SELECT 1" })
    io2 = StringIO.new
    subscriber2 = SlowQueryLog.subscribe(threshold_ms: 0, logger: ActiveSupport::Logger.new(io2))
    ActiveSupport::Notifications.notifier.publish_event(schema) rescue nil
    ActiveSupport::Notifications.unsubscribe(subscriber2)
    refute_includes io2.string, "SELECT 1"
  end

  test "production reads the threshold from SLOW_QUERY_MS with a 100 ms default" do
    source = File.read(Rails.root.join("config/environments/production.rb"))
    assert_match(/config\.x\.slow_query_ms = Integer\(ENV\.fetch\("SLOW_QUERY_MS", "100"\)/, source)
    refute_kind_of Numeric, Rails.configuration.x.slow_query_ms, "test leaves it unset, so nothing is subscribed at boot"
    assert_raises(ArgumentError, TypeError) { SlowQueryLog.subscribe(threshold_ms: nil) }
  end
end
