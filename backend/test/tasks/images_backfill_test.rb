require "test_helper"
require "rake"

# lib/tasks/images.rake: queues ImageVariantsJob for the finished bucket images that have no variants yet.
class ImagesBackfillTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  Rails.application.load_tasks unless Rake::Task.task_defined?("images:backfill")

  setup do
    @user = User.create!(name: "Backfill Artist", email: "backfill-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    @missing = upload!("a.jpg", "image/jpeg")
    @done = upload!("b.png", "image/png", variants: { "width" => 10, "height" => 10, "formats" => { "webp" => [320] } })
    @audio = upload!("c.mp3", "audio/mpeg")
    @pending = upload!("d.jpg", "image/jpeg", status: "pending")
    @disk = upload!("e.jpg", "image/jpeg", storage: "disk")
    %w[FORCE BATCH LIMIT].each { ENV.delete(_1) }
  end

  teardown { %w[FORCE BATCH LIMIT].each { ENV.delete(_1) } }

  test "queues only finished bucket images without variants, and a second run queues nothing new" do
    out, = capture_io { run_task }
    assert_match(/1 upload\(s\) queued/, out)
    assert_enqueued_with(job: ImageVariantsJob, args: [@missing.id])
    assert_equal 1, enqueued_jobs.count { _1["job_class"] == "ImageVariantsJob" }

    clear_enqueued_jobs
    @missing.update!(variants: { "width" => 10, "height" => 10, "formats" => { "webp" => [320] } })
    out, = capture_io { run_task }
    assert_match(/0 upload\(s\) queued/, out)
    assert_no_enqueued_jobs only: ImageVariantsJob
  end

  test "FORCE=1 redoes finished bucket images that already have variants, in batches" do
    ENV["FORCE"] = "1"
    ENV["BATCH"] = "1"
    out, = capture_io { run_task }
    assert_match(/2 upload\(s\) queued \(FORCE\)/, out)
    assert_equal [@done.id, @missing.id].sort, enqueued_jobs.select { _1["job_class"] == "ImageVariantsJob" }.map { _1["arguments"].first }.sort
  end

  private

  def run_task
    Rake::Task["images:backfill"].reenable
    Rake::Task["images:backfill"].invoke
  end

  def upload!(filename, content_type, variants: {}, status: "complete", storage: "s3")
    key = "uploads/#{@user.id}/#{SecureRandom.uuid}/#{filename}"
    Upload.create!(user: @user, storage:, key:, filename:, content_type:, byte_size: 10, status:, variants:,
      completed_at: (Time.current if status == "complete"), public_url: "https://media.example.test/#{key}")
  end
end
