require "test_helper"
require "minitest/mock"

# ImageVariants.enqueue_backfill: the queueing shared by `bin/rails images:backfill` and the deploy
# migration (db/migrate/20261004090000_enqueue_image_variants_backfill.rb).
class ImageVariantsBackfillTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  setup do
    @user = User.create!(name: "Backfill Artist", email: "backfill-svc-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    @missing = [upload!("a.jpg", "image/jpeg"), upload!("b.webp", "image/webp"), upload!("c.png", "image/png")]
    @done = upload!("d.png", "image/png", variants: { "width" => 10, "height" => 10, "formats" => { "webp" => [320] } })
    upload!("e.mp3", "audio/mpeg")
    upload!("f.jpg", "image/jpeg", status: "pending")
    upload!("g.jpg", "image/jpeg", storage: "disk")
    upload!("h.jpg", "image/jpeg", public_url: nil)
  end

  test "queues one default-queue job per finished bucket image without variants and returns the count" do
    assert_equal 3, ImageVariants.backfill_scope.count
    assert_equal 3, ImageVariants.enqueue_backfill
    jobs = enqueued_jobs.select { _1["job_class"] == "ImageVariantsJob" }
    assert_equal @missing.map(&:id).sort, jobs.map { _1["arguments"].first }.sort
    assert jobs.all? { _1["queue_name"] == "default" }
  end

  test "is idempotent: rows that got their variants are not queued again" do
    ImageVariants.enqueue_backfill
    clear_enqueued_jobs
    @missing.first.update!(variants: { "width" => 10, "height" => 10, "formats" => { "webp" => [320] } })
    assert_equal 2, ImageVariants.enqueue_backfill
    assert_equal 2, enqueued_jobs.count { _1["job_class"] == "ImageVariantsJob" }
    clear_enqueued_jobs
    @missing[1..].each { _1.update!(variants: { "width" => 10, "height" => 10, "formats" => { "webp" => [320] } }) }
    assert_equal 0, ImageVariants.enqueue_backfill
    assert_no_enqueued_jobs only: ImageVariantsJob
  end

  test "batches, reports progress, honours limit and force" do
    progress = []
    assert_equal 3, ImageVariants.enqueue_backfill(batch: 2) { progress << _1 }
    assert_equal [2, 3], progress
    clear_enqueued_jobs
    assert_equal 1, ImageVariants.enqueue_backfill(limit: 1)
    clear_enqueued_jobs
    assert_equal 4, ImageVariants.enqueue_backfill(force: true)
    assert_includes enqueued_jobs.map { _1["arguments"].first }, @done.id
  end

  test "the deploy migration skips in test and never raises when the queue is unavailable" do
    require Rails.root.join("db/migrate/20261004090000_enqueue_image_variants_backfill.rb").to_s
    migration = EnqueueImageVariantsBackfill.new
    migration.verbose = false
    assert_no_enqueued_jobs(only: ImageVariantsJob) { migration.up }

    Rails.stub(:env, ActiveSupport::EnvironmentInquirer.new("production")) do
      ImageVariants.stub(:enqueue_backfill, ->(*) { raise ActiveRecord::StatementInvalid, "good_jobs is gone" }) do
        assert_nothing_raised { migration.up }
      end
      assert_nothing_raised { migration.up }
      assert_equal 3, enqueued_jobs.count { _1["job_class"] == "ImageVariantsJob" }, "outside test it queues the missing ones"
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
