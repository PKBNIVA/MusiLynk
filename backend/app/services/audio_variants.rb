require "open3"
require "timeout"

# Derived copies of an uploaded audio file (AudioVariantsJob), made with ffmpeg. Settings come from
# config/audio.yml (docs/ops/uploads.md, "Audio variants").
#
# Every finished bucket audio upload gets a 30 s AAC preview (`<key>/v/preview.m4a`), a peaks JSON
# for the waveform (`<key>/v/peaks.json`) and, when the original is uncompressed (WAV), a full-length
# 128 kbps AAC transcode (`<key>/v/full.m4a`), all with a long immutable Cache-Control.
#
# The bytes are not trusted: the presigned PUT outlives `complete`, so the object can be replaced
# before the job runs. `inspect!` re-checks size and magic bytes against the Upload row and reads the
# duration with ffprobe, rejecting files over the configured caps before anything is decoded. ffmpeg
# runs with -nostdin, a fixed input format and a timeout, so a hostile file can neither prompt nor
# hang the single-thread default pool. A rejection is final (not retried).
module AudioVariants
  PATH = Rails.root.join("config/audio.yml")
  # Variant name => [bucket object basename, Content-Type].
  VARIANTS = { "preview" => ["preview.m4a", "audio/mp4"], "full" => ["full.m4a", "audio/mp4"], "peaks" => ["peaks.json", "application/json"] }.freeze
  # The ffmpeg demuxer each upload type must be read with (never ffmpeg's own guess).
  DEMUXERS = { "audio/mpeg" => "mp3", "audio/wav" => "wav" }.freeze
  # Ids per ActiveJob.perform_all_later insert in enqueue_backfill.
  BACKFILL_BATCH = 500
  # Decoded PCM read for the peaks: mono, 8 kHz, signed 16-bit (16 KB/s, so a 30 min file is 29 MB
  # streamed through a 64 KB buffer).
  PCM_RATE = 8000
  PCM_CHUNK = 64 * 1024

  # The file is not the audio the row describes, or is over the caps. Final: no retry.
  class Rejected < StandardError; end
  # ffmpeg/ffprobe failed or ran out of time. Retried like a storage failure.
  class ToolFailed < StandardError; end

  class << self
    def settings = @settings ||= YAML.safe_load_file(PATH).freeze
    def types = settings.fetch("types").map(&:to_s)
    def max_bytes = settings.fetch("max_bytes").to_i
    def max_duration = settings.fetch("max_duration_seconds").to_f
    def preview_seconds = settings.fetch("preview_seconds").to_i
    def preview_bitrate = settings.fetch("preview_bitrate").to_s
    def full_for = settings.fetch("full_for").map(&:to_s)
    def full_bitrate = settings.fetch("full_bitrate").to_s
    def peaks_points = settings.fetch("peaks_points").to_i
    def timeout_seconds = settings.fetch("ffmpeg_timeout_seconds").to_i
    def rlimit_as_bytes = settings.fetch("rlimit_as_bytes").to_i
    def rlimit_cpu_seconds = settings.fetch("rlimit_cpu_seconds").to_i
    def cache_control = settings.fetch("cache_control").to_s.presence

    def audio?(content_type) = types.include?(content_type.to_s)
    def full?(content_type) = full_for.include?(content_type.to_s)

    def variant_key(key, name) = "#{key}/v/#{VARIANTS.fetch(name).first}"
    def content_type(name) = VARIANTS.fetch(name).last

    # Checks the downloaded file against its Upload row and the caps and returns its duration in
    # seconds (a Float, from ffprobe's container header). Raises Rejected.
    def inspect!(path, upload)
      size = File.size(path)
      raise Rejected, "object is #{size} bytes, upload says #{upload.byte_size}" if size > upload.byte_size
      raise Rejected, "object is #{size} bytes, over the #{max_bytes} byte cap" if size > max_bytes
      detected = MediaTypeSniffer.detect(File.binread(path, MediaTypeSniffer::HEADER_BYTES))
      raise Rejected, "object bytes are #{detected || 'unknown'}, upload says #{upload.content_type}" unless detected == upload.content_type
      raise Rejected, "#{upload.content_type} is not an audio type the pipeline handles" unless audio?(upload.content_type)
      duration = probe_duration(path, upload.content_type)
      raise Rejected, "ffprobe found no duration" unless duration&.positive?
      raise Rejected, "#{duration.round(1)} s exceeds the #{max_duration.to_i} s cap" if duration > max_duration
      duration
    end

    # Produces every variant of `path` (checked by inspect!), yielding (name, file, content_type)
    # for each: "preview" (first `preview_seconds`, AAC), "full" (whole track, AAC) for the types in
    # `full_for`, and "peaks" (JSON). Returns the variants record for the Upload row:
    #   { "audio" => { "duration" => 123.4, "variants" => ["preview", "peaks", "full"], "peaks" => 400 } }
    def generate(path, upload, duration, dir)
      produced = []
      demuxer = DEMUXERS.fetch(upload.content_type)
      preview = File.join(dir, "preview.m4a")
      ffmpeg!([*input_args(demuxer), "-i", path, "-t", preview_seconds.to_s, "-vn", "-map_metadata", "-1", "-c:a", "aac", "-b:a", preview_bitrate, "-movflags", "+faststart", preview])
      File.open(preview, "rb") { yield "preview", _1, content_type("preview") }
      produced << "preview"

      if full?(upload.content_type)
        full = File.join(dir, "full.m4a")
        ffmpeg!([*input_args(demuxer), "-i", path, "-vn", "-map_metadata", "-1", "-c:a", "aac", "-b:a", full_bitrate, "-movflags", "+faststart", full])
        File.open(full, "rb") { yield "full", _1, content_type("full") }
        produced << "full"
      end

      points = peaks(path, demuxer, duration)
      peaks_file = File.join(dir, "peaks.json")
      File.write(peaks_file, { "version" => 1, "duration" => duration.round(3), "peaks" => points }.to_json)
      File.open(peaks_file, "rb") { yield "peaks", _1, content_type("peaks") }
      produced << "peaks"

      { "audio" => { "duration" => duration.round(3), "variants" => produced, "peaks" => points.length } }
    end

    # `peaks_points` values in 0..1 (the max absolute sample of each bucket over the track), computed
    # from ffmpeg's decoded mono 8 kHz PCM as it streams, PCM_CHUNK bytes at a time.
    def peaks(path, demuxer, duration)
      points = peaks_points
      per_point = [((duration * PCM_RATE) / points).ceil, 1].max
      peaks = Array.new(points, 0)
      index = 0
      consumed = 0
      run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1", *input_args(demuxer), "-i", path, "-vn", "-ac", "1", "-ar", PCM_RATE.to_s, "-f", "s16le", "pipe:1"]) do |stdout|
        while (chunk = stdout.read(PCM_CHUNK))
          chunk.unpack("s<*").each do |sample|
            slot = [index / per_point, points - 1].min
            value = sample.abs
            peaks[slot] = value if value > peaks[slot]
            index += 1
          end
          consumed += chunk.bytesize
        end
      end
      raise ToolFailed, "ffmpeg decoded no audio" if consumed.zero?
      peaks.map { (_1 / 32_768.0).round(3) }
    end

    # The container's duration from ffprobe, or nil when it has none. A file ffprobe cannot parse at
    # all is not the audio its row describes (a truncated or hostile upload), so that is a Rejected,
    # not a retry; only a missing binary or a timeout stays a ToolFailed.
    def probe_duration(path, content_type)
      out = run(["ffprobe", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file", "-f", DEMUXERS.fetch(content_type), "-show_entries", "format=duration", "-of", "json", path], &:read)
      JSON.parse(out).dig("format", "duration")&.to_f
    rescue JSON::ParserError
      nil
    rescue ToolFailed => e
      raise if e.message.match?(/not installed|exceeded/)
      raise Rejected, "ffprobe cannot read the file: #{e.message}"
    end

    # Input options for every ffmpeg read: only the local file protocol may be opened, so a reference
    # inside a hostile file (playlist, concat, subfile, http) can never reach the network or other files.
    def input_args(demuxer) = ["-protocol_whitelist", "file", "-f", demuxer]

    # Spawn options bounding the child's memory (address space) and CPU time, from config/audio.yml.
    def spawn_limits = { rlimit_as: rlimit_as_bytes, rlimit_cpu: rlimit_cpu_seconds }

    def ffmpeg!(args)
      run(["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", "1", "-y", *args], &:read)
    end

    # Runs a tool with no stdin, yields its stdout, kills it after `timeout_seconds`; raises ToolFailed
    # on a non-zero exit (with the first line of stderr, which names no secret) or a timeout.
    def run(command)
      Open3.popen3(*command, **spawn_limits) do |stdin, stdout, stderr, waiter|
        stdin.close
        result = nil
        errors = +""
        reader = Thread.new do
          errors << stderr.read.to_s
        rescue IOError
          nil # the pipe was closed under a timeout kill
        end
        begin
          Timeout.timeout(timeout_seconds) { result = yield stdout }
        rescue Timeout::Error
          Process.kill("KILL", waiter.pid) rescue nil
          waiter.value
          raise ToolFailed, "#{command.first} exceeded #{timeout_seconds} s"
        end
        reader.join
        status = waiter.value
        raise ToolFailed, "#{command.first} exited #{status.exitstatus}: #{errors.lines.first&.strip}" unless status.success?
        result
      end
    rescue Errno::ENOENT
      raise ToolFailed, "#{command.first} is not installed on this worker"
    end

    # The finished bucket audio uploads that can have variants (Upload#audio_variants_possible?, as a
    # relation): without variants unless `force`, at most `limit` rows.
    def backfill_scope(force: false, limit: nil)
      scope = Upload.complete.where(content_type: types, storage: "s3").where.not(public_url: nil)
      scope = scope.where(variants: {}) unless force
      scope = scope.limit(limit) if limit
      scope
    end

    # Enqueues AudioVariantsJob (queue default) for every row of backfill_scope, `batch` ids per insert,
    # and returns the number queued; yields the running total after each batch. Idempotent: a row
    # with variants is not queued again (unless `force`). Called by `bin/rails audio:backfill` and by
    # db/migrate/20261009110000_enqueue_audio_variants_backfill.rb.
    def enqueue_backfill(limit: nil, force: false, batch: BACKFILL_BATCH)
      enqueued = 0
      backfill_scope(force:, limit:).in_batches(of: batch).each do |relation|
        ids = relation.pluck(:id)
        ActiveJob.perform_all_later(ids.map { AudioVariantsJob.new(_1) })
        enqueued += ids.length
        yield enqueued if block_given?
      end
      enqueued
    end

    # Test seam: forget the settings.
    def reset!
      @settings = nil
    end
  end
end
