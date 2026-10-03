require "tmpdir"

# Generates the resized WebP/AVIF copies of one finished image upload (ImageVariants) and records
# them on the row. Enqueued by UploadsController#complete and by `bin/rails images:backfill`.
# A storage failure (download, upload) retries three times; a file that is not the image its row
# describes, is over the decode caps or that libvips cannot decode is given up on at once. Either
# way the upload keeps empty variants and the original is served on its own.
class ImageVariantsJob < ApplicationJob
  queue_as :default
  retry_on StandardError, wait: :polynomially_longer, attempts: 3
  # Strings: libvips is loaded lazily (ImageVariants.vips!), so the API boots without it.
  discard_on ImageVariants::Rejected, "Vips::Error" do |job, error|
    Rails.logger.warn({ event: "image_variants_rejected", uploadId: job.arguments.first, error: error.class.name, message: error.message.lines.first&.strip }.to_json)
  end

  def perform(upload_id)
    upload = Upload.find_by(id: upload_id)
    return unless upload&.variants_possible?
    # The worker needs the bucket variables (docs/ops/uploads.md); without them the feature is off,
    # not broken: the original keeps being served and nothing is retried or reported.
    unless UploadStorage.direct? && UploadStorage.ready?
      Rails.logger.info({ event: "image_variants_skipped", reason: "storage_not_configured", uploadId: upload.id }.to_json)
      return
    end

    Dir.mktmpdir("musilynk-variants") do |dir|
      original = File.join(dir, "original")
      UploadStorage.download(upload.key, original)
      image = ImageVariants.inspect!(original, upload)
      record = ImageVariants.generate(image) do |width, format, file|
        UploadStorage.put_object(ImageVariants.variant_key(upload.key, width, format), body: file,
          content_type: ImageVariants.content_type(format), cache_control: ImageVariants.cache_control)
      end
      upload.update!(variants: record.merge("generatedAt" => Time.current.iso8601))
    end
  end
end
