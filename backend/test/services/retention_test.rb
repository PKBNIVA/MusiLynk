require "test_helper"
require "minitest/mock"

# Retention / RetentionSweepJob (config/retention.yml, docs/ops/retention.md): each rule deletes
# what is past its window and keeps what is not, with the boundary itself kept.
class RetentionTest < ActiveSupport::TestCase
  setup do
    @now = Time.zone.parse("2026-10-03 12:00:00")
    @seq = 0
    @user = person("Retention Person")
  end

  test "sign-in codes go one day after they expire" do
    old = code(expires_at: @now - 1.day - 1.second)
    edge = code(expires_at: @now - 1.day)
    live = code(expires_at: @now + 5.minutes)
    assert_equal 1, sweep("sign_in_codes").count
    assert_not SignInCode.exists?(old.id)
    assert SignInCode.exists?(edge.id), "exactly at the window is kept"
    assert SignInCode.exists?(live.id)
  end

  test "sessions go seven days after they expire, by idle timeout or absolute lifetime" do
    old = session_row(expires_at: @now - 8.days)
    absolute = session_row(expires_at: @now + 1.day, absolute_expires_at: @now - 8.days)
    recent = session_row(expires_at: @now - 6.days)
    edge = session_row(expires_at: @now - 7.days)
    live = session_row(expires_at: @now + 1.day, absolute_expires_at: @now + 10.days)
    assert_equal 2, sweep("sessions").count
    assert_equal [edge, live, recent].map(&:id).sort, Session.where(id: [old, absolute, recent, edge, live].map(&:id)).pluck(:id).sort
  end

  test "notifications go ninety days after they were read; unread ones stay however old" do
    old_read = Notification.create!(user: @user, kind: "system", title: "Old", read_at: @now - 91.days, created_at: @now - 200.days)
    edge = Notification.create!(user: @user, kind: "system", title: "Edge", read_at: @now - 90.days)
    unread = Notification.create!(user: @user, kind: "system", title: "Unread", created_at: @now - 400.days)
    assert_equal 1, sweep("notifications").count
    assert_equal [edge.id, unread.id].sort, Notification.where(id: [old_read, edge, unread].map(&:id)).pluck(:id).sort
  end

  test "problem-report screenshots go thirty days after the report was handled; the report and newer screenshots stay" do
    old = report(created_at: @now - 60.days, status: "resolved", handled_at: @now - 31.days)
    fresh = report(created_at: @now - 60.days, status: "triaged", handled_at: @now - 29.days)
    old_blob = old.screenshot_blob_id
    assert_equal 1, sweep("problem_report_screenshots").count
    assert_nil old.reload.screenshot_blob_id
    assert_equal "Something broke", old.description, "the report itself is kept"
    assert_not ActiveStorage::Blob.exists?(old_blob)
    assert fresh.reload.screenshot_blob_id
    assert ActiveStorage::Blob.exists?(fresh.screenshot_blob_id)
  end

  test "an untriaged report keeps its screenshot however old" do
    untriaged = report(created_at: @now - 40.days)
    legacy = report(created_at: @now - 40.days, status: "resolved")
    assert_equal 1, sweep("problem_report_screenshots").count, "a handled report without handled_at counts from when it was filed"
    assert untriaged.reload.screenshot_blob_id
    assert ActiveStorage::Blob.exists?(untriaged.screenshot_blob_id)
    assert_nil legacy.reload.screenshot_blob_id
  end

  test "analytics events go after 180 days" do
    event("old", @now - 181.days)
    event("edge", @now - 180.days)
    event("new", @now - 1.day)
    assert_equal 1, sweep("product_events").count
    assert_equal %w[edge new], ProductEvent.where(id: %w[pe_old pe_edge pe_new]).order(:id).pluck(:anon_id)
  end

  test "an erased account's analytics events and others' recently-viewed entries go thirty days after erasure" do
    erased_long_ago = person("Erased Long Ago")
    erased_recently = person("Erased Recently")
    viewer = person("Viewer")
    erased_long_ago.update_columns(status: "deleted", name: "Deleted account", updated_at: @now - 31.days)
    erased_recently.update_columns(status: "deleted", name: "Deleted account", updated_at: @now - 29.days)
    event("gone", @now - 2.days, user: erased_long_ago)
    event("kept", @now - 2.days, user: erased_recently)
    event("live", @now - 2.days, user: viewer)
    gone_view = RecentActivity.create!(user: viewer, kind: "profile_view", entity_id: erased_long_ago.id, label: "Old Name")
    kept_view = RecentActivity.create!(user: viewer, kind: "profile_view", entity_id: erased_recently.id, label: "Other Name")
    assert_equal 2, sweep("erased_account_residue").count
    assert_equal %w[kept live], ProductEvent.where(id: %w[pe_gone pe_kept pe_live]).order(:anon_id).pluck(:anon_id)
    assert_not RecentActivity.exists?(gone_view.id)
    assert RecentActivity.exists?(kept_view.id)
    assert User.exists?(erased_long_ago.id), "the anonymised user row itself is kept"
  end

  test "finished GoodJob records and their executions go after fourteen days; unfinished ones stay" do
    old = good_job(finished_at: @now - 15.days)
    discarded = good_job(finished_at: @now - 20.days, error: "boom")
    recent = good_job(finished_at: @now - 13.days)
    queued = good_job(finished_at: nil)
    assert_equal 2, sweep("good_jobs").count
    assert_equal [recent, queued].sort, GoodJob::Job.where(active_job_id: [old, discarded, recent, queued]).pluck(:active_job_id).sort
    assert_equal 0, GoodJob::Execution.where(active_job_id: [old, discarded]).count
    assert_equal 1, GoodJob::Execution.where(active_job_id: recent).count
  end

  test "a dry run counts what would go and deletes nothing" do
    code(expires_at: @now - 3.days)
    Notification.create!(user: @user, kind: "system", title: "Old", read_at: @now - 100.days)
    outcomes = Retention.sweep(now: @now, dry_run: true).index_by(&:rule)
    assert_equal 1, outcomes["sign_in_codes"].count
    assert_equal 1, outcomes["notifications"].count
    assert outcomes.values.all?(&:dry_run)
    assert_equal 1, SignInCode.where(expires_at: ...@now).count
    assert_equal 1, Notification.where(read_at: ...@now).count
  end

  test "each rule deletes in batches and stops at the per-run cap, reporting that more is left" do
    5.times { code(expires_at: @now - 3.days) }
    config = Retention.config.merge("batch_size" => 2, "max_per_run" => 3)
    Retention.stub(:config, config) do
      first = sweep("sign_in_codes")
      assert_equal 3, first.count
      assert first.capped
      second = sweep("sign_in_codes")
      assert_equal 2, second.count
      assert_not second.capped
    end
  end

  test "the sweep logs one line per rule with counts only, and the job runs every rule" do
    code(expires_at: @now - 3.days)
    log = capture_log { travel_to(@now) { RetentionSweepJob.perform_now } }
    lines = log.lines.filter_map { JSON.parse(_1[/\{.*\}/]) rescue nil }.select { _1["event"] == "retention_sweep" }
    assert_equal Retention::RULES.keys.sort, lines.pluck("rule").sort
    assert(lines.all? { (_1.keys - %w[event rule deleted wouldDelete capped dryRun]).empty? }, "counts only")
    assert_equal 1, lines.find { _1["rule"] == "sign_in_codes" }["deleted"]
    assert_equal "scheduled", RetentionSweepJob.new.queue_name
    assert_equal "RetentionSweepJob", Rails.application.config.good_job.cron.fetch(:retention_sweep).fetch(:class)
    assert_equal 14 * 86_400, Rails.application.config.good_job.cleanup_preserved_jobs_before_seconds_ago
  end

  test "config/retention.yml must name exactly the known rules, with positive days and the right 'after'" do
    assert_equal Retention::RULES.keys.sort, Retention.config.fetch("rules").keys.sort
    raw = YAML.safe_load_file(Retention::CONFIG_PATH)
    [
      raw.merge("rules" => raw["rules"].except("sessions")),
      raw.merge("rules" => raw["rules"].merge("sessions" => { "after" => "expired", "days" => 0 })),
      raw.merge("rules" => raw["rules"].merge("sessions" => { "after" => "created", "days" => 7 }))
    ].each do |bad|
      YAML.stub(:safe_load_file, bad) do
        Retention.instance_variable_set(:@config, nil)
        assert_raises(ArgumentError) { Retention.config }
      end
    end
  ensure
    Retention.instance_variable_set(:@config, nil)
  end

  private

  def sweep(rule) = Retention.sweep_rule(rule, now: @now)

  def person(name)
    @seq += 1
    User.create!(name:, email: "retention-#{@seq}-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
  end

  def code(expires_at:)
    SignInCode.create!(email: "code-#{SecureRandom.hex(3)}@example.com", code_digest: SecureRandom.hex(16), expires_at:)
  end

  def session_row(expires_at:, absolute_expires_at: nil)
    @user.sessions.create!(token_digest: SecureRandom.hex(16), expires_at:, absolute_expires_at:)
  end

  def report(created_at:, status: "new", handled_at: nil)
    blob = ActiveStorage::Blob.create_and_upload!(io: StringIO.new("png bytes"), filename: "shot.png", content_type: "image/png")
    ProblemReport.create!(user: @user, description: "Something broke", screenshot_blob: blob, created_at:, status:, handled_at:)
  end

  def event(name, created_at, user: nil)
    ProductEvent.insert_all([{ id: "pe_#{name}", anon_id: name, user_id: user&.id, name: "landing_view", props: {}, created_at: }])
  end

  def good_job(finished_at:, error: nil)
    id = SecureRandom.uuid
    GoodJob::Job.create!(active_job_id: id, queue_name: "default", job_class: "UploadSweepJob", finished_at:, error:, created_at: @now - 30.days)
    GoodJob::Execution.create!(active_job_id: id, job_class: "UploadSweepJob", queue_name: "default", finished_at:, error:, created_at: @now - 30.days) if finished_at
    id
  end

  def capture_log
    io = StringIO.new
    original = Rails.logger
    Rails.logger = ActiveSupport::Logger.new(io)
    yield
    io.string
  ensure
    Rails.logger = original
  end
end
