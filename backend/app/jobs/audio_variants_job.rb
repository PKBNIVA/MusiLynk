require "tmpdir"

# Makes the preview clip, the waveform peaks and (for WAV) the AAC transcode of one finished audio
# upload (AudioVariants) and records them on the row. Enqueued by UploadsController#complete and by
# `bin/rails audio:backfill`. A storage or ffmpeg failure retries three times; a file that is not the
# audio its row describes or is over the caps is given up on at once. Either way the upload keeps
# empty variants and the original is served on its own.
class AudioVariantsJob < ApplicationJob
  queue_as :default
  retry_on StandardError, wait: :polynomially_longer, attempts: 3
  discard_on AudioVariants::Rejected do |job, error|
    Rails.logger.warn({ event: "audio_variants_rejected", uploadId: job.arguments.first, error: error.class.name, message: error.message.lines.first&.strip }.to_json)
  end

  def perform(upload_id)
    upload = Upload.find_by(id: upload_id)
    return unless upload&.audio_variants_possible?
    # The worker needs the bucket variables (docs/ops/uploads.md); without them the feature is off,
    # not broken: the original keeps being served and nothing is retried or reported.
    unless UploadStorage.direct? && UploadStorage.ready?
      Rails.logger.info({ event: "audio_variants_skipped", reason: "storage_not_configured", uploadId: upload.id }.to_json)
      return
    end

    Dir.mktmpdir("musilynk-audio") do |dir|
      original = File.join(dir, "original")
      UploadStorage.download(upload.key, original)
      duration = AudioVariants.inspect!(original, upload)
      record = AudioVariants.generate(original, upload, duration, dir) do |name, file, content_type|
        UploadStorage.put_object(AudioVariants.variant_key(upload.key, name), body: file, content_type:, cache_control: AudioVariants.cache_control)
      end
      upload.update!(variants: record.merge("generatedAt" => Time.current.iso8601))
    end
  end
end
