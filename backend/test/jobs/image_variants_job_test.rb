require "test_helper"
require "minitest/mock"
require "aws-sdk-s3"

# ImageVariantsJob + ImageVariants against a real libvips encode of test/fixtures/files/variants-sample.jpg
# (1000x750, EXIF orientation 6: a portrait 750x1000 once rotated). Storage is replaced by in-memory
# stubs of UploadStorage.download/put_object; the fake bucket is covered by upload_storage_test.rb.
class ImageVariantsJobTest < ActiveJob::TestCase
  FIXTURE = Rails.root.join("test/fixtures/files/variants-sample.jpg")

  setup do
    @user = User.create!(name: "Variant Artist", email: "variants-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    @upload = Upload.create!(user: @user, storage: "s3", key: "uploads/#{@user.id}/abc/photo.jpg", filename: "photo.jpg", content_type: "image/jpeg",
      byte_size: File.size(FIXTURE), status: "complete", completed_at: Time.current, public_url: "https://media.example.test/uploads/#{@user.id}/abc/photo.jpg")
    @stored = {}
    ImageVariants.reset!
  end

  teardown { ImageVariants.reset! }

  test "generates rotated, stripped WebP variants up to the original's width and records them" do
    with_fake_storage do
      ImageVariants.stub(:avif?, false) { ImageVariantsJob.perform_now(@upload.id) }
    end
    variants = @upload.reload.variants
    assert_equal 750, variants["width"], "EXIF orientation 6 makes the 1000x750 file a 750x1000 image"
    assert_equal 1000, variants["height"]
    assert_equal({ "webp" => [320] }, variants["formats"], "768 and 1600 would upscale a 750 px image")
    assert variants["generatedAt"].present?

    key = "#{@upload.key}/v/320.webp"
    assert_equal [key], @stored.keys
    assert_equal "image/webp", @stored[key][:content_type]
    assert_equal "public, max-age=31536000, immutable", @stored[key][:cache_control]
    image = Vips::Image.new_from_buffer(@stored[key][:body], "")
    assert_equal 320, image.width
    assert_equal 427, image.height, "resized along the rotated axis, aspect kept"
    assert_not_includes image.get_fields, "orientation", "metadata stripped"
    assert_not_includes image.get_fields, "exif-data"
    assert_operator @stored[key][:body].bytesize, :<, File.size(FIXTURE)

    assert_equal "#{@upload.public_url}/v/320.webp", @upload.variant_url(320, "webp")
    assert_nil @upload.variant_url(768, "webp")
    assert_nil @upload.variant_url(320, "avif")
    set = @upload.image_set
    assert_equal @upload.public_url, set[:src]
    assert_equal({ "webp" => ["#{@upload.public_url}/v/320.webp 320w"] }, set[:srcset])
    assert_equal [750, 1000], [set[:width], set[:height]]
  end

  test "also writes AVIF when the libvips build can encode AV1, and every configured width for a large image" do
    skip "this libvips has no AV1 encoder (the Debian libvips42 in the Dockerfile does)" unless ImageVariants.avif?
    large = Vips::Image.new_from_file(FIXTURE.to_s).resize(2.2) # 2200 px wide, orientation stripped by resize
    Dir.mktmpdir do |dir|
      path = File.join(dir, "large.jpg")
      large.jpegsave(path, Q: 50)
      with_fake_storage(path) { ImageVariantsJob.perform_now(@upload.id) }
    end
    formats = @upload.reload.variants["formats"]
    assert_equal({ "avif" => [320, 768, 1600], "webp" => [320, 768, 1600] }, formats)
    assert_equal "image/avif", @stored["#{@upload.key}/v/768.avif"][:content_type]
    assert_equal 768, Vips::Image.new_from_buffer(@stored["#{@upload.key}/v/768.avif"], "").width
  end

  test "the encoder probe falls back to WebP alone without AV1, and formats put AVIF first with it" do
    ImageVariants.stub(:avif?, false) { assert_equal %w[webp], ImageVariants.formats }
    ImageVariants.reset!
    ImageVariants.stub(:avif?, true) { assert_equal %w[avif webp], ImageVariants.formats }
  end

  test "skips uploads that are not finished bucket images and leaves their variants empty" do
    audio = Upload.create!(user: @user, storage: "s3", key: "uploads/#{@user.id}/def/take.mp3", filename: "take.mp3", content_type: "audio/mpeg",
      byte_size: 10, status: "complete", completed_at: Time.current, public_url: "https://media.example.test/uploads/#{@user.id}/def/take.mp3")
    pending = Upload.create!(user: @user, storage: "s3", key: "uploads/#{@user.id}/ghi/p.png", filename: "p.png", content_type: "image/png", byte_size: 10, status: "pending")
    disk = Upload.create!(user: @user, storage: "disk", key: "blobkey", filename: "d.png", content_type: "image/png", byte_size: 10, status: "complete", public_url: "http://api.test/rails/active_storage/x")
    downloads = 0
    UploadStorage.stub(:download, ->(*) { downloads += 1 }) do
      [audio, pending, disk, "missing-id"].each { ImageVariantsJob.perform_now(_1.is_a?(Upload) ? _1.id : _1) }
    end
    assert_equal 0, downloads
    assert_equal [{}, {}, {}], [audio, pending, disk].map { _1.reload.variants }
    assert_nil audio.image_set
    assert_nil audio.api_json[:image]
  end

  test "without bucket configuration on the worker the job logs and skips instead of failing" do
    downloads = 0
    UploadStorage.stub(:direct?, false) do
      UploadStorage.stub(:download, ->(*) { downloads += 1 }) { ImageVariantsJob.perform_now(@upload.id) }
    end
    assert_equal 0, downloads
    assert_equal({}, @upload.reload.variants)
  end

  test "a storage failure retries three times and then leaves the original in use" do
    failing = ->(*) { raise Aws::S3::Errors::ServiceError.new(nil, "bucket down") }
    with_bucket_env { UploadStorage.stub(:download, failing) do
      assert_enqueued_jobs 1, only: ImageVariantsJob do
        ImageVariantsJob.perform_now(@upload.id) # first attempt: re-enqueued with a wait
      end
      job = ImageVariantsJob.new(@upload.id)
      job.executions = 3 # the attempts are used up (retry_on counts per exception class): nothing is re-enqueued
      job.exception_executions = { "[StandardError]" => 3 }
      assert_no_enqueued_jobs(only: ImageVariantsJob) { assert_raises(Aws::S3::Errors::ServiceError) { job.perform_now } }
    end }
    assert_equal({}, @upload.reload.variants)
    assert_nil @upload.image_set
    assert_equal @upload.public_url, @upload.api_json[:url]
  end

  test "purging an upload deletes its variants with the original, and variant_keys lists them" do
    @upload.update!(variants: { "width" => 750, "height" => 1000, "formats" => { "webp" => [320], "avif" => [320] } })
    assert_equal ["#{@upload.key}/v/320.webp", "#{@upload.key}/v/320.avif"].sort, @upload.variant_keys.sort
    deleted = nil
    UploadStorage.stub(:delete, ->(storage, key, extra) { deleted = [storage, key, extra] }) { @upload.purge! }
    assert_equal ["s3", @upload.key, @upload.variant_keys], deleted
    assert_not Upload.exists?(@upload.id)
  end

  private

  def with_fake_storage(source = FIXTURE.to_s, &block)
    download = ->(_key, path) { FileUtils.cp(source, path) }
    put = ->(key, body:, content_type:, cache_control: nil) { @stored[key] = { body: body.read.b, content_type:, cache_control: } }
    with_bucket_env do
      UploadStorage.stub(:download, download) { UploadStorage.stub(:put_object, put, &block) }
    end
  end

  def with_bucket_env
    UploadStorage.stub(:direct?, true) { UploadStorage.stub(:ready?, true) { yield } }
  end
end
