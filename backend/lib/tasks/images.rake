# Image variants for uploads made before ImageVariantsJob existed (docs/ops/uploads.md, "Image variants").
# The deploy that added the column already queued this once (db/migrate/20261004090000_enqueue_image_variants_backfill.rb);
# the task is for a retry, a FORCE run after changing config/images.yml, or a trial with LIMIT.
namespace :images do
  desc "Enqueue ImageVariantsJob for finished image uploads without variants (FORCE=1 redoes all; BATCH=n ids per batch; LIMIT=n stops after n)"
  task backfill: :environment do
    force = ENV["FORCE"] == "1"
    limit = Integer(ENV["LIMIT"]) if ENV["LIMIT"].present?
    batch = Integer(ENV.fetch("BATCH", ImageVariants::BACKFILL_BATCH))
    count = ImageVariants.backfill_scope(force:, limit:).count
    puts "images:backfill #{Rails.env}: #{count} upload(s) to queue#{force ? ' (FORCE: redoing existing variants)' : ''}."
    # Production puts every one of these on the worker's single-thread default pool: an admin runs it
    # from a Railway shell, on purpose (docs/ops/uploads.md).
    if Rails.env.production? && ENV["CONFIRM"] != "images-backfill"
      abort "images:backfill refuses to run in production without CONFIRM=images-backfill."
    end
    enqueued = ImageVariants.enqueue_backfill(limit:, force:, batch:) { |done| puts "images:backfill enqueued #{done}" }
    puts "images:backfill done: #{enqueued} upload(s) queued#{force ? ' (FORCE)' : ''}."
  end
end
