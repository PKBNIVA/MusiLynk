require "test_helper"
require "minitest/mock"
require "aws-sdk-s3"

# AudioVariantsJob + AudioVariants against a real ffmpeg run over test/fixtures/files/audio-sample.wav
# (2 s, 440 Hz sine, mono 8 kHz) and audio-sample.mp3 (the same tone). Storage is replaced by in-memory
# stubs of UploadStorage.download/put_object, as in image_variants_job_test.rb.
class AudioVariantsJobTest < ActiveJob::TestCase
  WAV = Rails.root.join("test/fixtures/files/audio-sample.wav")
  MP3 = Rails.root.join("test/fixtures/files/audio-sample.mp3")

  setup do
    @user = User.create!(name: "Audio Artist", email: "audio-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    @upload = upload!("take.wav", "audio/wav", File.size(WAV))
    @stored = {}
    @scratch = Dir.mktmpdir("audio-test")
    AudioVariants.reset!
  end

  teardown do
    AudioVariants.reset!
    FileUtils.rm_rf(@scratch)
  end

  test "a WAV gets a preview clip, a full AAC transcode and peaks, all immutable, recorded on the row" do
    with_fake_storage(WAV) { AudioVariantsJob.perform_now(@upload.id) }
    variants = @upload.reload.variants
    assert_in_delta 2.0, variants.dig("audio", "duration"), 0.05
    assert_equal %w[preview full peaks], variants.dig("audio", "variants")
    assert_equal 400, variants.dig("audio", "peaks")
    assert variants["generatedAt"].present?

    assert_equal ["#{@upload.key}/v/preview.m4a", "#{@upload.key}/v/full.m4a", "#{@upload.key}/v/peaks.json"].sort, @stored.keys.sort
    @stored.each_value { assert_equal "public, max-age=31536000, immutable", _1[:cache_control] }
    assert_equal "audio/mp4", @stored["#{@upload.key}/v/preview.m4a"][:content_type]
    assert_equal "audio/mp4", @stored["#{@upload.key}/v/full.m4a"][:content_type]
    assert_equal "application/json", @stored["#{@upload.key}/v/peaks.json"][:content_type]
    # MP4 containers start with an ftyp box; the preview is far smaller than the uncompressed original.
    assert_equal "ftyp", @stored["#{@upload.key}/v/preview.m4a"][:body][4, 4]
    assert_equal "ftyp", @stored["#{@upload.key}/v/full.m4a"][:body][4, 4]
    assert_operator @stored["#{@upload.key}/v/preview.m4a"][:body].bytesize, :<, File.size(WAV)
    peaks = JSON.parse(@stored["#{@upload.key}/v/peaks.json"][:body])
    assert_equal 1, peaks["version"]
    assert_in_delta 2.0, peaks["duration"], 0.05
    assert_equal 400, peaks["peaks"].length
    assert peaks["peaks"].all? { _1.is_a?(Numeric) && _1.between?(0, 1) }
    # ffmpeg's sine source is -18 dBFS (amplitude 1/8), sustained over the whole clip.
    assert_in_delta 0.125, peaks["peaks"].max, 0.01
    assert_operator peaks["peaks"].min, :>, 0.08, "the tone is sustained over the whole clip"

    set = @upload.audio_set
    assert_equal "#{@upload.public_url}/v/preview.m4a", set[:preview]
    assert_equal "#{@upload.public_url}/v/full.m4a", set[:full]
    assert_equal "#{@upload.public_url}/v/peaks.json", set[:peaks]
    assert_in_delta 2.0, set[:duration], 0.05
    assert_equal %i[preview full peaks duration], set.keys
    assert_equal set, @upload.api_json[:audio]
    assert_nil @upload.api_json[:image]
    assert_equal @stored.keys.sort, @upload.variant_keys.sort
  end

  test "an MP3 gets the preview and peaks but no full transcode: the original is the full track" do
    mp3 = upload!("take.mp3", "audio/mpeg", File.size(MP3))
    with_fake_storage(MP3) { AudioVariantsJob.perform_now(mp3.id) }
    assert_equal %w[preview peaks], mp3.reload.variants.dig("audio", "variants")
    assert_equal ["#{mp3.key}/v/preview.m4a", "#{mp3.key}/v/peaks.json"].sort, @stored.keys.sort
    set = mp3.audio_set
    assert_equal "#{mp3.public_url}/v/preview.m4a", set[:preview]
    assert_nil set[:full]
    assert_equal "#{mp3.public_url}/v/peaks.json", set[:peaks]
  end

  test "skips uploads that are not finished bucket audio files and leaves their variants empty" do
    image = upload!("p.png", "image/png", 10)
    pending = upload!("p.wav", "audio/wav", 10, status: "pending", public_url: nil)
    disk = upload!("d.wav", "audio/wav", 10, storage: "disk", public_url: "http://api.test/rails/active_storage/x")
    downloads = 0
    UploadStorage.stub(:download, ->(*) { downloads += 1 }) do
      [image, pending, disk, "missing-id"].each { AudioVariantsJob.perform_now(_1.is_a?(Upload) ? _1.id : _1) }
    end
    assert_equal 0, downloads
    assert_equal [{}, {}, {}], [image, pending, disk].map { _1.reload.variants }
    assert_nil image.audio_set
    assert_nil image.api_json[:audio]
  end

  test "an object whose bytes no longer match the row (swapped after complete) is rejected for good, not retried" do
    with_fake_storage(MP3) do # the row says audio/wav; the bucket now holds an MP3 of the right size
      @upload.update!(byte_size: File.size(MP3))
      assert_no_enqueued_jobs(only: AudioVariantsJob) { AudioVariantsJob.perform_now(@upload.id) }
    end
    assert_empty @stored
    assert_equal({}, @upload.reload.variants)

    # Right magic bytes but more bytes than the upload recorded: also rejected.
    with_fake_storage(WAV) do
      @upload.update!(byte_size: File.size(WAV) - 1)
      assert_no_enqueued_jobs(only: AudioVariantsJob) { AudioVariantsJob.perform_now(@upload.id) }
    end
    assert_empty @stored

    # Bytes that are no allowed media type (an HTML page renamed .wav): rejected before ffmpeg sees it.
    html = File.join(@scratch, "renamed.wav")
    File.write(html, "<html><script>1</script></html>")
    with_fake_storage(html) do
      @upload.update!(byte_size: 10_000)
      runs = 0
      AudioVariants.stub(:run, ->(*) { runs += 1 }) { AudioVariantsJob.perform_now(@upload.id) }
      assert_equal 0, runs
    end
    assert_empty @stored
    assert_equal({}, @upload.reload.variants)
  end

  test "a file over the duration or byte cap is rejected at the probe, before any transcode" do
    long = File.join(@scratch, "long.wav")
    system("ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=4", "-ac", "1", "-ar", "8000", "-sample_fmt", "s16", long, exception: true)
    AudioVariants.stub(:max_duration, 3.0) do
      error = assert_raises(AudioVariants::Rejected) { AudioVariants.inspect!(long, Upload.new(content_type: "audio/wav", byte_size: File.size(long))) }
      assert_match(/4\.0 s exceeds the 3 s cap/, error.message)
      with_fake_storage(long) do
        @upload.update!(byte_size: File.size(long))
        assert_no_enqueued_jobs(only: AudioVariantsJob) { AudioVariantsJob.perform_now(@upload.id) }
      end
    end
    assert_empty @stored
    assert_equal({}, @upload.reload.variants)

    AudioVariants.stub(:max_bytes, 1000) do
      error = assert_raises(AudioVariants::Rejected) { AudioVariants.inspect!(WAV.to_s, Upload.new(content_type: "audio/wav", byte_size: File.size(WAV))) }
      assert_match(/over the 1000 byte cap/, error.message)
    end
    assert_in_delta 2.0, AudioVariants.inspect!(WAV.to_s, Upload.new(content_type: "audio/wav", byte_size: File.size(WAV))), 0.05
    assert_equal 1800, AudioVariants.max_duration
    assert_equal 100.megabytes, AudioVariants.max_bytes
    assert_equal %w[audio/mpeg audio/wav], AudioVariants.types
  end

  test "a WAV ffprobe cannot parse is rejected for good; an ffmpeg failure on a sound file is retried like a storage error" do
    broken = File.join(@scratch, "broken.wav")
    File.binwrite(broken, File.binread(WAV, 44) + "\x00".b * 20) # the RIFF header with no data chunk
    error = assert_raises(AudioVariants::Rejected) { AudioVariants.inspect!(broken, Upload.new(content_type: "audio/wav", byte_size: 1000)) }
    assert_match(/ffprobe cannot read the file|no duration/, error.message)

    with_fake_storage(WAV) do
      AudioVariants.stub(:ffmpeg!, ->(*) { raise AudioVariants::ToolFailed, "ffmpeg exited 1: boom" }) do
        assert_enqueued_jobs(1, only: AudioVariantsJob) { AudioVariantsJob.perform_now(@upload.id) }
      end
    end
    assert_empty @stored
    assert_equal({}, @upload.reload.variants)
  end

  test "every ffmpeg call runs without stdin and under the configured timeout" do
    commands = []
    original = AudioVariants.method(:run)
    AudioVariants.stub(:run, ->(command, &block) { commands << command; original.call(command, &block) }) do
      with_fake_storage(WAV) { AudioVariantsJob.perform_now(@upload.id) }
    end
    ffmpeg = commands.select { _1.first == "ffmpeg" }
    assert_equal 3, ffmpeg.length, "preview, full, peaks"
    ffmpeg.each { assert_includes _1, "-nostdin" }
    ffmpeg.each { assert_equal "wav", _1[_1.index("-f") + 1], "the demuxer is fixed from the row, never guessed" }
    assert_equal 180, AudioVariants.timeout_seconds
    AudioVariants.stub(:timeout_seconds, 1) do
      error = assert_raises(AudioVariants::ToolFailed) { AudioVariants.run(["sleep", "5"], &:read) }
      assert_match(/exceeded 1 s/, error.message)
    end
    error = assert_raises(AudioVariants::ToolFailed) { AudioVariants.run(["no-such-tool-xyz"], &:read) }
    assert_match(/not installed/, error.message)
  end

  test "every ffmpeg and ffprobe call whitelists only the file protocol and ffmpeg runs one thread" do
    commands = []
    original = AudioVariants.method(:run)
    AudioVariants.stub(:run, ->(command, &block) { commands << command; original.call(command, &block) }) do
      with_fake_storage(WAV) { AudioVariantsJob.perform_now(@upload.id) }
    end
    assert_equal %w[ffprobe ffmpeg ffmpeg ffmpeg], commands.map(&:first), "probe, preview, full, peaks"
    commands.each do |command|
      index = command.index("-protocol_whitelist")
      assert index, "#{command.first} has no -protocol_whitelist"
      assert_equal "file", command[index + 1]
      assert_operator index, :<, (command.index("-i") || command.length), "it is an input option, before -i"
    end
    commands.select { _1.first == "ffmpeg" }.each { assert_equal "1", _1[_1.index("-threads") + 1] }
  end

  test "every spawned tool gets the memory and CPU limits from config/audio.yml" do
    assert_equal 2_147_483_648, AudioVariants.rlimit_as_bytes
    assert_equal 300, AudioVariants.rlimit_cpu_seconds
    received = nil
    original = Open3.method(:popen3)
    Open3.stub(:popen3, ->(*args, **opts, &block) { received = opts; original.call(*args, **opts, &block) }) do
      AudioVariants.run(["true"], &:read)
    end
    assert_equal({ rlimit_as: 2_147_483_648, rlimit_cpu: 300 }, received)
    # The kernel really applies it to the child (ulimit -v is in KiB).
    AudioVariants.stub(:rlimit_as_bytes, 1_073_741_824) do
      assert_equal "1048576", AudioVariants.run(["sh", "-c", "ulimit -v"], &:read).strip
    end
  end

  test "without bucket configuration on the worker the job logs and skips instead of failing" do
    downloads = 0
    UploadStorage.stub(:direct?, false) do
      UploadStorage.stub(:download, ->(*) { downloads += 1 }) { AudioVariantsJob.perform_now(@upload.id) }
    end
    assert_equal 0, downloads
    assert_equal({}, @upload.reload.variants)
  end

  test "a storage failure retries three times and then leaves the original in use" do
    failing = ->(*) { raise Aws::S3::Errors::ServiceError.new(nil, "bucket down") }
    with_bucket_env { UploadStorage.stub(:download, failing) do
      assert_enqueued_jobs(1, only: AudioVariantsJob) { AudioVariantsJob.perform_now(@upload.id) }
      job = AudioVariantsJob.new(@upload.id)
      job.executions = 3
      job.exception_executions = { "[StandardError]" => 3 }
      assert_no_enqueued_jobs(only: AudioVariantsJob) { assert_raises(Aws::S3::Errors::ServiceError) { job.perform_now } }
    end }
    assert_equal({}, @upload.reload.variants)
    assert_nil @upload.audio_set
    assert_equal @upload.public_url, @upload.api_json[:url]
  end

  test "purging an upload deletes its audio variants with the original, and the sweep treats them as its own" do
    @upload.update!(variants: { "audio" => { "duration" => 2.0, "variants" => %w[preview full peaks], "peaks" => 400 } })
    expected = %w[preview.m4a full.m4a peaks.json].map { "#{@upload.key}/v/#{_1}" }
    assert_equal expected.sort, @upload.variant_keys.sort
    expected.each { assert_equal @upload.key, _1.sub(UploadSweepJob::VARIANT_SUFFIX, "") }
    assert_equal "#{@upload.key}/v/notes.txt", "#{@upload.key}/v/notes.txt".sub(UploadSweepJob::VARIANT_SUFFIX, "")
    deleted = nil
    UploadStorage.stub(:delete, ->(storage, key, extra) { deleted = [storage, key, extra] }) { @upload.purge! }
    assert_equal ["s3", @upload.key, expected], deleted
    assert_not Upload.exists?(@upload.id)
  end

  test "completing an audio upload enqueues the job; an image enqueues the image job only" do
    assert AudioVariantsJob.new.queue_name == "default"
    assert @upload.audio_variants_possible?
    assert_not @upload.variants_possible?
    image = upload!("p.png", "image/png", 10)
    assert image.variants_possible?
    assert_not image.audio_variants_possible?
  end

  private

  def upload!(filename, content_type, byte_size, status: "complete", storage: "s3", public_url: :default)
    key = "uploads/#{@user.id}/#{SecureRandom.uuid}/#{filename}"
    public_url = "https://media.example.test/#{key}" if public_url == :default
    Upload.create!(user: @user, storage:, key:, filename:, content_type:, byte_size:, status:,
      completed_at: (Time.current if status == "complete"), public_url:)
  end

  def with_fake_storage(source, &block)
    download = ->(_key, path) { FileUtils.cp(source.to_s, path) }
    put = ->(key, body:, content_type:, cache_control: nil) { @stored[key] = { body: body.read.b, content_type:, cache_control: } }
    with_bucket_env do
      UploadStorage.stub(:download, download) { UploadStorage.stub(:put_object, put, &block) }
    end
  end

  def with_bucket_env
    UploadStorage.stub(:direct?, true) { UploadStorage.stub(:ready?, true) { yield } }
  end
end
