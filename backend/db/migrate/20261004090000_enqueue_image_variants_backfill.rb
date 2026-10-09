# Gives the uploads made before ImageVariantsJob existed their resized copies: queues the job for every
# finished bucket image without variants (ImageVariants.enqueue_backfill, 500 ids per insert on the
# default queue), so nobody has to run `bin/rails images:backfill` from a Railway shell. The migration
# itself writes no upload rows and is idempotent: rows already carrying variants are not queued again.
# Skipped in test (CI migrates from scratch), and a queue that cannot take the jobs does not fail the
# deploy: the task above remains the manual path. Rolling back has nothing to undo.
class EnqueueImageVariantsBackfill < ActiveRecord::Migration[8.1]
  def up
    return if Rails.env.test?
    count = ImageVariants.enqueue_backfill
    Rails.logger.info({ event: "image_variants_backfill_enqueued", count:, source: "migration" }.to_json)
    say "image variants backfill: #{count} upload(s) queued"
  rescue StandardError => e
    Rails.logger.warn({ event: "image_variants_backfill_skipped", error: e.class.name, message: e.message.lines.first&.strip, source: "migration" }.to_json)
    say "image variants backfill skipped (#{e.class}): run bin/rails images:backfill later"
  end

  def down; end
end
