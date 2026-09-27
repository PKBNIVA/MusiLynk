require "test_helper"

class SyntheticQaDemoLockTest < ActiveSupport::TestCase
  test "the admin lock is released even when the query cache is on" do
    connection = ApplicationRecord.lease_connection
    ActiveRecord::Base.cache do
      # The first call writes (as enqueueing a job does), which clears the query cache
      # between its lock and unlock; the second call must still really unlock.
      assert_equal :queued, SyntheticQa::Demo.with_admin_lock { connection.clear_query_cache; :queued }
      assert_equal :busy, SyntheticQa::Demo.with_admin_lock { :busy }
    end

    assert_equal 0, held_demo_locks(connection)
  ensure
    connection&.select_value("SELECT pg_advisory_unlock_all()")
  end

  private

  def held_demo_locks(connection)
    connection.uncached do
      connection.select_value(<<~SQL.squish).to_i
        SELECT count(*) FROM pg_locks
        WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND objid = #{SyntheticQa::Demo::ADVISORY_LOCK_KEY & 0xffffffff}
      SQL
    end
  end
end
