require "test_helper"
require "rake"
require "minitest/mock"

# lib/tasks/perf_seed.rake: the volume seed behind docs/PERFORMANCE.md's query plans.
class PerfSeedTest < ActiveSupport::TestCase
  Rails.application.load_tasks unless defined?(PerfSeed)

  test "seeds every table at a small scale, and a second run adds nothing" do
    out = StringIO.new
    counts = PerfSeed.call(scale: 0.0002, out:)
    assert_equal 10, counts[:users]
    assert_equal counts[:users], User.where("id LIKE 'user_perf_%'").count
    assert_equal counts[:conversations] * counts[:messages_per_thread], Message.where("id LIKE 'msg_perf_%'").count
    assert Session.exists?(token_digest: Digest::SHA256.hexdigest(PerfSeed::PROBE_TOKENS[:jobseeker]))

    again = StringIO.new
    PerfSeed.call(scale: 0.0002, out: again)
    assert_match(/users: 0 new of 10/, again.string)
    assert_match(/messages: 0 new of/, again.string)
  end

  test "refuses production and a non-local database" do
    Rails.stub(:env, ActiveSupport::EnvironmentInquirer.new("production")) do
      assert_raises(SystemExit) { capture_io { PerfSeed.guard! } }
    end
    original = ENV["DATABASE_URL"]
    ENV["DATABASE_URL"] = "postgres://user@db.example.com:5432/prod"
    assert_raises(SystemExit) { capture_io { PerfSeed.guard! } }
  ensure
    ENV["DATABASE_URL"] = original
  end
end
