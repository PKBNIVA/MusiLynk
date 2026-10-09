# Gives the audio uploads made before AudioVariantsJob existed their preview, peaks and transcode:
# queues the job for every finished bucket audio file without variants (AudioVariants.enqueue_backfill,
# 500 ids per insert on the default queue), so nobody has to run `bin/rails audio:backfill` from a
# Railway shell. Same pattern as 20261004090000_enqueue_image_variants_backfill.rb: the migration
# writes no upload rows and is idempotent (rows already carrying variants are not queued again),
# is skipped in test (CI migrates from scratch), and a queue that cannot take the jobs does not fail
# the deploy. Rolling back has nothing to undo.
class EnqueueAudioVariantsBackfill < ActiveRecord::Migration[8.1]
  def up
    return if Rails.env.test?
    count = AudioVariants.enqueue_backfill
    Rails.logger.info({ event: "audio_variants_backfill_enqueued", count:, source: "migration" }.to_json)
    say "audio variants backfill: #{count} upload(s) queued"
  rescue StandardError => e
    Rails.logger.warn({ event: "audio_variants_backfill_skipped", error: e.class.name, message: e.message.lines.first&.strip, source: "migration" }.to_json)
    say "audio variants backfill skipped (#{e.class}): run bin/rails audio:backfill later"
  end

  def down; end
end
