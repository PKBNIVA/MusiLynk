# Resized copies of an uploaded image (ImageVariantsJob), encoded with libvips through the
# image_processing gem. Settings come from config/images.yml (docs/ops/uploads.md, "Image variants").
#
# Every variant is EXIF-rotated, stripped of metadata and capped at one of `widths` (never upscaled),
# saved as WebP and, when this libvips build can encode AV1, as AVIF. Variants live next to the
# original under `<key>/v/<width>.<ext>` with a long immutable Cache-Control.
#
# The bytes are not trusted: the presigned PUT outlives `complete`, so the object can be replaced
# before the job runs. `inspect!` re-checks size and magic bytes against the Upload row, lets libvips
# use only its jpeg/png/webp loaders (block_untrusted, vips-loader) and rejects images over the
# configured pixel/dimension caps before anything is decoded. A rejection is final (not retried).
module ImageVariants
  PATH = Rails.root.join("config/images.yml")
  FORMATS = { "webp" => "image/webp", "avif" => "image/avif" }.freeze
  # Vips reads these; anything else allowed through uploads (audio, video, PDF) is not an image.
  IMAGE_TYPES = %w[image/jpeg image/png image/webp].freeze
  # The libvips loader each type must come through (`vips-loader` header field).
  LOADERS = { "image/jpeg" => "jpegload", "image/png" => "pngload", "image/webp" => "webpload" }.freeze

  # The file is not the image the row describes, or is too large to decode. Final: no retry.
  class Rejected < StandardError; end

  class << self
    def settings = @settings ||= YAML.safe_load_file(PATH).freeze
    def widths = settings.fetch("widths").map(&:to_i).sort
    def quality(format) = settings.fetch("quality").fetch(format).to_i
    def cache_control = settings.fetch("cache_control").to_s.presence
    def max_pixels = settings.fetch("max_pixels").to_i
    def max_dimension = settings.fetch("max_dimension").to_i

    def image?(content_type) = IMAGE_TYPES.include?(content_type.to_s)

    def variant_key(key, width, format) = "#{key}/v/#{width}.#{format}"
    def content_type(format) = FORMATS.fetch(format)

    # Loads libvips once per process with the worker-friendly settings: untrusted loaders (magick,
    # poppler, rsvg, openslide...) blocked, a small thread pool and operation cache so one encode
    # cannot crowd out the single-thread default queue's other jobs.
    def vips!
      return ::Vips if defined?(@vips_ready) && @vips_ready
      require "vips"
      require "image_processing/vips"
      ::Vips.block_untrusted(true)
      ::Vips.concurrency_set(2)
      ::Vips.cache_set_max(16)
      ::Vips.cache_set_max_mem(64 * 1024 * 1024)
      @vips_ready = true
      ::Vips
    end

    # The formats this process can encode, best first: AVIF only when libvips was built with an AV1
    # encoder (Debian's libvips42 is; the check runs once per process and costs a 2x2 encode).
    def formats
      @formats ||= avif? ? %w[avif webp] : %w[webp]
    end

    def avif?
      return @avif if defined?(@avif)
      vips!
      ::Vips::Image.black(2, 2).heifsave_buffer(Q: 50, compression: :av1)
      @avif = true
    rescue StandardError, LoadError
      @avif = false
    end

    # Checks the downloaded file against its Upload row and the decode caps, and returns the lazily
    # opened Vips image (header only; nothing is decoded yet). Raises Rejected.
    def inspect!(path, upload)
      size = File.size(path)
      raise Rejected, "object is #{size} bytes, upload says #{upload.byte_size}" if size > upload.byte_size
      detected = MediaTypeSniffer.detect(File.binread(path, MediaTypeSniffer::HEADER_BYTES))
      raise Rejected, "object bytes are #{detected || 'unknown'}, upload says #{upload.content_type}" unless detected == upload.content_type
      vips!
      image = ::Vips::Image.new_from_file(path, fail_on: :error)
      loader = image.get("vips-loader")
      raise Rejected, "libvips loader #{loader} is not #{LOADERS[upload.content_type]}" unless loader == LOADERS[upload.content_type]
      if image.width > max_dimension || image.height > max_dimension || image.width.to_i * image.height > max_pixels
        raise Rejected, "#{image.width}x#{image.height} exceeds #{max_dimension} px / #{max_pixels} pixels"
      end
      image
    rescue ::Vips::Error => e
      raise Rejected, "libvips cannot read the header: #{e.message.lines.first&.strip}"
    end

    # Encodes every width x format of `image` (from inspect!), yielding (width, format, tempfile) for
    # each; returns the variants record for the Upload row:
    #   { "width" => W, "height" => H, "formats" => { "webp" => [320, 768], "avif" => [...] } }
    # where W x H is the rotated original's size and the lists hold the widths produced.
    def generate(image)
      vips!
      original = ImageProcessing::Vips.source(image).call(save: false) # autorotated
      produced = Hash.new { |hash, format| hash[format] = [] }
      widths.each do |width|
        next if width > original.width && width != widths.first # never upscale; the smallest step always exists
        formats.each do |format|
          file = ImageProcessing::Vips.source(original).resize_to_limit(width, nil).convert(format)
            .saver(quality: quality(format), strip: true).call
          begin
            yield width, format, file
          ensure
            file.close!
          end
          produced[format] << width
        end
      end
      { "width" => original.width, "height" => original.height, "formats" => produced.to_h }
    end

    # Test seam: forget the per-process encoder probe and settings.
    def reset!
      remove_instance_variable(:@avif) if defined?(@avif)
      @formats = nil
      @settings = nil
    end
  end
end
