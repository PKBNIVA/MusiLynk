require "test_helper"

# Uses a second real connection (on another thread), so it cannot run inside a transactional test.
class DemoAdminLockTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  KEY = SyntheticQa::Demo::ADVISORY_LOCK_KEY

  test "the lock is free again once the block finishes, so it cannot leak into later requests" do
    assert_equal :done, SyntheticQa::Demo.with_admin_lock { :done }
    assert on_other_connection { |conn| conn.select_value("SELECT pg_try_advisory_xact_lock(#{KEY})") }
  end

  test "another holder makes the admin lock report :locked instead of waiting" do
    held = Queue.new
    release = Queue.new
    holder = Thread.new do
      on_other_connection do |conn|
        conn.select_value("SELECT pg_advisory_xact_lock(#{KEY})")
        held << true
        release.pop
      end
    end
    held.pop
    ran = false
    assert_equal :locked, SyntheticQa::Demo.with_admin_lock { ran = true }
    assert_not ran
  ensure
    release&.push(true)
    holder&.join
  end

  private

  # Runs the block inside a transaction on a connection other than this thread's.
  def on_other_connection(&block)
    result = nil
    Thread.new do
      ApplicationRecord.connection_pool.with_connection { |conn| result = conn.transaction { block.call(conn) } }
    end.join
    result
  end
end
