require "test_helper"
require "minitest/mock"
require "aws-sdk-s3"
require "open3"

# DatabaseBackup (backup:dump / backup:verify / BackupToR2Job), docs/ops/backups.md.
class DatabaseBackupTest < ActiveSupport::TestCase
  # pg_dump reads committed rows from its own session, and CREATE DATABASE cannot run in a transaction.
  self.use_transactional_tests = false

  setup do
    @dir = Dir.mktmpdir("backup-test")
    @users = Array.new(3) { |i| User.create!(name: "Backup Person #{i}", email: "backup-#{i}-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active") }
  end

  teardown do
    User.where(id: @users.map(&:id)).delete_all
    FileUtils.rm_rf(@dir)
    DatabaseBackup.s3 = nil
  end

  test "dump then verify restores into a temporary database, compares the biggest tables and drops it" do
    result = DatabaseBackup.dump(File.join(@dir, "test.dump"))
    assert_operator result.bytes, :>, 0
    manifest = JSON.parse(File.read(result.manifest_path))
    assert_equal User.count, manifest.dig("tables", "users")
    assert_equal "redacted", manifest["database"]

    checks = DatabaseBackup.verify(result.path, limit: 3)
    assert_equal 3, checks.size
    assert checks.all?(&:ok?), checks.inspect
    assert_includes checks.map(&:table), "users"
    leftover = ActiveRecord::Base.lease_connection.select_values("SELECT datname FROM pg_database WHERE datname LIKE '%_verify_%'")
    assert_empty leftover, "the scratch database is dropped"
  end

  test "verify reports a table whose restored count differs from the manifest" do
    result = DatabaseBackup.dump(File.join(@dir, "test.dump"))
    manifest = JSON.parse(File.read(result.manifest_path))
    manifest["tables"]["users"] += 1
    File.write(result.manifest_path, manifest.to_json)
    users = DatabaseBackup.verify(result.path).find { _1.table == "users" }
    assert_not users.ok?
  end

  test "connection details reach pg tools only through the child environment, never the command line" do
    db = { host: "db.internal", port: 5432, username: "app", password: "s3cret-pw", database: "musilynk", sslmode: "require" }
    calls = []
    fake_pg = Object.new
    def fake_pg.exec(*) = self
    counter = DatabaseBackup::Counter.new(fake_pg)
    def counter.select_value(*) = "snap-1"
    Open3.stub(:capture3, ->(env, *cmd) { calls << [env, cmd]; ["", "", Struct.new(:success?, :exitstatus).new(true, 0)] }) do
      DatabaseBackup.stub(:with_connection, ->(*, &block) { block.call(counter) }) do
        DatabaseBackup.stub(:table_counts, { "users" => 1 }) do
          File.write(File.join(@dir, "x.dump"), "x")
          DatabaseBackup.dump(File.join(@dir, "x.dump"), db:)
        end
      end
    end
    env, cmd = calls.first
    assert_equal "pg_dump", cmd.first
    assert_equal({ "PGHOST" => "db.internal", "PGPORT" => "5432", "PGUSER" => "app", "PGPASSWORD" => "s3cret-pw", "PGDATABASE" => "musilynk", "PGSSLMODE" => "require" }, env)
    assert(cmd.none? { _1.include?("s3cret") || _1.include?("postgres://") })
    assert_includes cmd, "--snapshot=snap-1", "pg_dump reads the snapshot the counts are taken in"
  end

  test "a failing pg tool raises with its error, and verify refuses production without a scratch database" do
    File.write(File.join(@dir, "bad.dump"), "not a dump")
    File.write(File.join(@dir, "bad.dump.manifest.json"), { tables: { "users" => 1 } }.to_json)
    error = assert_raises(DatabaseBackup::Error) { DatabaseBackup.verify(File.join(@dir, "bad.dump")) }
    assert_match(/pg_restore failed/, error.message)
    Rails.stub(:env, ActiveSupport::EnvironmentInquirer.new("production")) do
      assert_raises(DatabaseBackup::Error) { DatabaseBackup.verify(File.join(@dir, "bad.dump")) }
    end
  end

  test "upload copies the dump and manifest under backups/ and prune deletes only copies past the retention window" do
    s3 = Aws::S3::Client.new(stub_responses: true)
    now = Time.current
    s3.stub_responses(:head_object, ->(context) { { content_length: File.size(File.join(@dir, context.params[:key].delete_prefix("backups/"))) } })
    s3.stub_responses(:list_objects_v2, { contents: [
      { key: "backups/musilynk-20260801T213000Z.dump.enc", last_modified: now - 31.days },
      { key: "backups/musilynk-20260801T213000Z.dump.manifest.json", last_modified: now - 31.days },
      { key: "backups/musilynk-20260905T213000Z.dump.enc", last_modified: now - 29.days },
      { key: "backups/hand-made-export.sql", last_modified: now - 400.days },
      { key: "backups/musilynk-20260801T213000Z.dump", last_modified: now - 400.days }
    ], is_truncated: false })
    deleted = []
    s3.stub_responses(:delete_objects, ->(context) { deleted.concat(context.params[:delete][:objects].pluck(:key)); {} })
    DatabaseBackup.s3 = s3
    File.write(File.join(@dir, "a.dump"), "dump bytes")
    File.write(File.join(@dir, "a.dump.manifest.json"), "{}")
    with_bucket("musilynk-backups") do
      with_env("BACKUP_PASSPHRASE", nil) { assert_raises(DatabaseBackup::Error) { DatabaseBackup.upload(File.join(@dir, "a.dump")) } }
      with_env("BACKUP_PASSPHRASE", "correct horse battery staple") do
        assert_equal %w[backups/a.dump.enc backups/a.dump.manifest.json], DatabaseBackup.upload(File.join(@dir, "a.dump"))
      end
      assert_equal 2, DatabaseBackup.prune(now:)
    end
    assert_equal %w[backups/musilynk-20260801T213000Z.dump.enc backups/musilynk-20260801T213000Z.dump.manifest.json], deleted,
      "only this code's own encrypted dumps and manifests; other objects under backups/ survive"
    assert_equal({ "prefix" => "backups/", "retention_days" => 30, "verify_tables" => 10 }, DatabaseBackup.config)
  end

  test "the dump's row counts come from the dump's own snapshot, so a write during the dump never shows as a mismatch" do
    path = File.join(@dir, "busy.dump")
    real_run = DatabaseBackup.method(:run!)
    # A write lands while pg_dump runs: it must appear in neither the dump nor the manifest.
    DatabaseBackup.stub(:run!, ->(*args) { real_run.call(*args).tap { User.create!(name: "Mid Dump", email: "mid-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active").tap { @users << _1 } } }) do
      DatabaseBackup.dump(path)
    end
    assert_equal User.count - 1, JSON.parse(File.read("#{path}.manifest.json")).dig("tables", "users")
    users = DatabaseBackup.verify(path).find { _1.table == "users" }
    assert users.ok?, users.inspect
  end

  test "the cron entry is registered only when BACKUP_BUCKET is set" do
    assert_nil BackupSchedule.cron_entry(env: {})
    assert_nil BackupSchedule.cron_entry(env: { "BACKUP_BUCKET" => "  " })
    entry = BackupSchedule.cron_entry(env: { "BACKUP_BUCKET" => "musilynk-backups" })
    assert_equal({ cron: "30 21 * * 6", class: "BackupToR2Job" }, entry.slice(:cron, :class))
    assert_equal ENV["BACKUP_BUCKET"].present?, Rails.application.config.good_job.cron.key?(:backup_to_r2)
  end

  test "an upload with a bucket but no passphrase fails before anything is dumped" do
    with_bucket("musilynk-backups") do
      with_env("BACKUP_PASSPHRASE", nil) do
        DatabaseBackup.stub(:dump, ->(*) { flunk "dumped without a passphrase" }) do
          error = assert_raises(DatabaseBackup::Error) { BackupToR2Job.perform_now }
          assert_match(/BACKUP_PASSPHRASE/, error.message)
        end
      end
    end
  end

  test "BackupToR2Job does nothing without BACKUP_BUCKET, and dumps, uploads and prunes with it" do
    with_bucket(nil) do
      DatabaseBackup.stub(:dump, ->(*) { flunk "dumped without a bucket" }) { BackupToR2Job.perform_now }
    end
    steps = []
    fake = DatabaseBackup::Result.new(path: "x", manifest_path: "x.manifest.json", bytes: 1, tables: 1, rows: 1)
    with_bucket("musilynk-backups") do
      DatabaseBackup.stub(:ensure_upload_ready!, nil) do
        DatabaseBackup.stub(:dump, ->(path) { steps << [:dump, File.basename(path)]; fake }) do
          DatabaseBackup.stub(:upload, ->(path) { steps << [:upload, path]; %w[k1 k2] }) do
            DatabaseBackup.stub(:prune, -> { steps << [:prune]; 0 }) { BackupToR2Job.perform_now }
          end
        end
      end
    end
    assert_equal :dump, steps[0][0]
    assert_match(/\Amusilynk-\d{8}T\d{6}Z\.dump\z/, steps[0][1])
    assert_equal [[:upload, "x"], [:prune]], steps.drop(1)
    assert_equal "scheduled", BackupToR2Job.new.queue_name
  end

  test "an encrypted copy decrypts with stock openssl, and verify restores it after checking the checksum" do
    result = DatabaseBackup.dump(File.join(@dir, "test.dump"))
    encrypted = DatabaseBackup.encrypt(result.path, "#{result.path}.enc", secret: "correct horse battery staple")
    assert_not_equal File.binread(result.path).first(64), File.binread(encrypted).first(64)
    plain = File.join(@dir, "openssl.dump")
    _out, err, status = Open3.capture3({ "BACKUP_PASSPHRASE" => "correct horse battery staple" }, "openssl", "enc", "-d", "-aes-256-cbc", "-pbkdf2",
      "-iter", DatabaseBackup::PBKDF2_ITERATIONS.to_s, "-md", "sha256", "-pass", "env:BACKUP_PASSPHRASE", "-in", encrypted.to_s, "-out", plain)
    assert status.success?, err
    assert_equal Digest::SHA256.file(result.path).hexdigest, Digest::SHA256.file(plain).hexdigest

    with_env("BACKUP_PASSPHRASE", "correct horse battery staple") do
      File.delete(result.path)
      assert DatabaseBackup.verify(encrypted, limit: 2).all?(&:ok?)
    end
    with_env("BACKUP_PASSPHRASE", "wrong passphrase") do
      assert_raises(DatabaseBackup::Error) { DatabaseBackup.verify(encrypted) }
    end
  end

  test "verify refuses a dump that does not match its manifest checksum" do
    result = DatabaseBackup.dump(File.join(@dir, "test.dump"))
    File.open(result.path, "ab") { _1.write("x") }
    error = assert_raises(DatabaseBackup::Error) { DatabaseBackup.verify(result.path) }
    assert_match(/checksum/, error.message)
  end

  private

  def with_bucket(value, &) = with_env("BACKUP_BUCKET", value, &)

  def with_env(name, value)
    previous = ENV[name]
    value.nil? ? ENV.delete(name) : ENV[name] = value
    yield
  ensure
    previous.nil? ? ENV.delete(name) : ENV[name] = previous
  end
end
