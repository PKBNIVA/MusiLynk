require "test_helper"
require "minitest/mock"

# AudioVariants.enqueue_backfill: the queueing shared by `bin/rails audio:backfill` and the deploy
# migration (db/migrate/20261009110000_enqueue_audio_variants_backfill.rb).
class AudioVariantsBackfillTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  DONE = { "audio" => { "duration" => 2.0, "variants" => %w[preview peaks], "peaks" => 400 } }.freeze

  setup do
    @user = User.create!(name: "Audio Backfill", email: "audio-backfill-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    @missing = [upload!("a.mp3", "audio/mpeg"), upload!("b.wav", "audio/wav")]
    @done = upload!("c.wav", "audio/wav", variants: DONE)
    upload!("d.jpg", "image/jpeg")
    upload!("e.mp4", "video/mp4")
    upload!("f.wav", "audio/wav", status: "pending")
    upload!("g.wav", "audio/wav", storage: "disk")
    upload!("h.wav", "audio/wav", public_url: nil)
  end

  test "queues one default-queue job per finished bucket audio file without variants and returns the count" do
    assert_equal 2, AudioVariants.backfill_scope.count
    assert_equal 2, AudioVariants.enqueue_backfill
    jobs = enqueued_jobs.select { _1["job_class"] == "AudioVariantsJob" }
    assert_equal @missing.map(&:id).sort, jobs.map { _1["arguments"].first }.sort
    assert jobs.all? { _1["queue_name"] == "default" }
    assert_no_enqueued_jobs only: ImageVariantsJob
  end

  test "is idempotent, batches, honours limit and force" do
    progress = []
    assert_equal 2, AudioVariants.enqueue_backfill(batch: 1) { progress << _1 }
    assert_equal [1, 2], progress
    clear_enqueued_jobs
    @missing.first.update!(variants: DONE)
    assert_equal 1, AudioVariants.enqueue_backfill
    clear_enqueued_jobs
    assert_equal 1, AudioVariants.enqueue_backfill(limit: 1, force: true)
    clear_enqueued_jobs
    assert_equal 3, AudioVariants.enqueue_backfill(force: true)
    assert_includes enqueued_jobs.map { _1["arguments"].first }, @done.id
  end

  test "the deploy migration skips in test and never raises when the queue is unavailable" do
    require Rails.root.join("db/migrate/20261009110000_enqueue_audio_variants_backfill.rb").to_s
    migration = EnqueueAudioVariantsBackfill.new
    migration.verbose = false
    assert_no_enqueued_jobs(only: AudioVariantsJob) { migration.up }

    Rails.stub(:env, ActiveSupport::EnvironmentInquirer.new("production")) do
      AudioVariants.stub(:enqueue_backfill, ->(*) { raise ActiveRecord::StatementInvalid, "good_jobs is gone" }) do
        assert_nothing_raised { migration.up }
      end
      assert_nothing_raised { migration.up }
      assert_equal 2, enqueued_jobs.count { _1["job_class"] == "AudioVariantsJob" }, "outside test it queues the missing ones"
    end
  end

  private

  def upload!(filename, content_type, variants: {}, status: "complete", storage: "s3", public_url: :default)
    key = "uploads/#{@user.id}/#{SecureRandom.uuid}/#{filename}"
    public_url = "https://media.example.test/#{key}" if public_url == :default
    Upload.create!(user: @user, storage:, key:, filename:, content_type:, byte_size: 10, status:, variants:,
      completed_at: (Time.current if status == "complete"), public_url:)
  end
end
