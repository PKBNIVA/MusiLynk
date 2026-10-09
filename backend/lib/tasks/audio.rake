# Audio variants for uploads made before AudioVariantsJob existed (docs/ops/uploads.md, "Audio variants").
# The deploy that added the job already queued this once (db/migrate/20261009110000_enqueue_audio_variants_backfill.rb);
# the task is for a retry, a FORCE run after changing config/audio.yml, or a trial with LIMIT.
namespace :audio do
  desc "Enqueue AudioVariantsJob for finished audio uploads without variants (FORCE=1 redoes all; BATCH=n ids per batch; LIMIT=n stops after n)"
  task backfill: :environment do
    force = ENV["FORCE"] == "1"
    limit = Integer(ENV["LIMIT"]) if ENV["LIMIT"].present?
    batch = Integer(ENV.fetch("BATCH", AudioVariants::BACKFILL_BATCH))
    count = AudioVariants.backfill_scope(force:, limit:).count
    puts "audio:backfill #{Rails.env}: #{count} upload(s) to queue#{force ? ' (FORCE: redoing existing variants)' : ''}."
    # Production puts every one of these on the worker's single-thread default pool (a WAV transcode
    # takes seconds): an admin runs it from a Railway shell, on purpose (docs/ops/uploads.md).
    if Rails.env.production? && ENV["CONFIRM"] != "audio-backfill"
      abort "audio:backfill refuses to run in production without CONFIRM=audio-backfill."
    end
    enqueued = AudioVariants.enqueue_backfill(limit:, force:, batch:) { |done| puts "audio:backfill enqueued #{done}" }
    puts "audio:backfill done: #{enqueued} upload(s) queued#{force ? ' (FORCE)' : ''}."
  end
end
