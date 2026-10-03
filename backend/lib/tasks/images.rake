# Image variants for uploads made before ImageVariantsJob existed (docs/ops/uploads.md, "Image variants").
namespace :images do
  desc "Enqueue ImageVariantsJob for finished image uploads without variants (FORCE=1 redoes all; BATCH=n ids per batch; LIMIT=n stops after n)"
  task backfill: :environment do
    scope = Upload.complete.where(content_type: ImageVariants::IMAGE_TYPES, storage: "s3").where.not(public_url: nil)
    scope = scope.where(variants: {}) unless ENV["FORCE"] == "1"
    scope = scope.limit(Integer(ENV["LIMIT"])) if ENV["LIMIT"].present?
    batch = Integer(ENV.fetch("BATCH", 500))
    count = scope.count
    puts "images:backfill #{Rails.env}: #{count} upload(s) to queue#{ENV['FORCE'] == '1' ? ' (FORCE: redoing existing variants)' : ''}."
    # Production puts every one of these on the worker's single-thread default pool: an admin runs it
    # from a Railway shell, on purpose (docs/ops/uploads.md).
    if Rails.env.production? && ENV["CONFIRM"] != "images-backfill"
      abort "images:backfill refuses to run in production without CONFIRM=images-backfill."
    end
    enqueued = 0
    scope.in_batches(of: batch).each do |relation|
      ids = relation.pluck(:id)
      ActiveJob.perform_all_later(ids.map { ImageVariantsJob.new(_1) })
      enqueued += ids.length
      puts "images:backfill enqueued #{enqueued}"
    end
    puts "images:backfill done: #{enqueued} upload(s) queued#{ENV['FORCE'] == '1' ? ' (FORCE)' : ''}."
  end
end
