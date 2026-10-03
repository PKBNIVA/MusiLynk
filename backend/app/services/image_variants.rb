# Resized copies of an uploaded image (ImageVariantsJob), encoded with libvips through the
# image_processing gem. Settings come from config/images.yml (docs/ops/uploads.md, "Image variants").
#
# Every variant is EXIF-rotated, stripped of metadata and capped at one of `widths` (never upscaled),
# saved as WebP and, when this libvips build can encode AV1, as AVIF. Variants live next to the
# original under `<key>/v/<width>.<ext>` with a long immutable Cache-Control.
module ImageVariants
  PATH = Rails.root.join("config/images.yml")
  FORMATS = { "webp" => "image/webp", "avif" => "image/avif" }.freeze
  # Vips reads these; anything else allowed through uploads (audio, video, PDF) is not an image.
  IMAGE_TYPES = %w[image/jpeg image/png image/webp].freeze

  class << self
    def settings = @settings ||= YAML.safe_load_file(PATH).freeze
    def widths = settings.fetch("widths").map(&:to_i).sort
    def quality(format) = settings.fetch("quality").fetch(format).to_i
    def cache_control = settings.fetch("cache_control").to_s.presence

    def image?(content_type) = IMAGE_TYPES.include?(content_type.to_s)

    def variant_key(key, width, format) = "#{key}/v/#{width}.#{format}"
    def content_type(format) = FORMATS.fetch(format)

    # The formats this process can encode, best first: AVIF only when libvips was built with an AV1
    # encoder (Debian's libvips42 is; the check runs once per process and costs a 2x2 encode).
    def formats
      @formats ||= avif? ? %w[avif webp] : %w[webp]
    end

    def avif?
      return @avif if defined?(@avif)
      require "vips"
      Vips::Image.black(2, 2).heifsave_buffer(Q: 50, compression: :av1)
      @avif = true
    rescue StandardError, LoadError
      @avif = false
    end

    # Encodes every width x format of the image at `source_path`, yielding (width, format, tempfile)
    # for each; returns the variants record for the Upload row:
    #   { "width" => W, "height" => H, "formats" => { "webp" => [320, 768], "avif" => [...] } }
    # where W x H is the rotated original's size and the lists hold the widths produced.
    def generate(source_path)
      require "image_processing/vips"
      original = ImageProcessing::Vips.source(source_path).call(save: false) # autorotated
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

    # Test seam: forget the per-process encoder probe.
    def reset!
      remove_instance_variable(:@avif) if defined?(@avif)
      @formats = nil
      @settings = nil
    end
  end
end
