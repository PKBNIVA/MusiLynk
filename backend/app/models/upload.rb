# One stored upload object. Direct (S3/R2) uploads start "pending" and become
# "complete" only after UploadsController#complete has verified the stored object;
# streamed (Disk) uploads are verified before they are stored and start "complete".
class Upload < ApplicationRecord
  STATUSES = %w[pending complete].freeze
  STORAGES = %w[s3 disk].freeze
  MAX_SIZE = 100.megabytes
  STALE_AFTER = 24.hours

  belongs_to :user, optional: true

  validates :storage, inclusion: { in: STORAGES }
  validates :status, inclusion: { in: STATUSES }
  validates :key, :filename, presence: true
  validates :content_type, inclusion: { in: MediaTypeSniffer::ALLOWED_TYPES }
  validates :byte_size, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: MAX_SIZE }

  scope :complete, -> { where(status: "complete") }
  # The finished uploads among `urls` that carry generated variants (image or audio), for one lookup
  # per page (ImageSet.from_uploads, AudioSet.from_uploads). An empty list runs no query.
  scope :variants_by_url, ->(urls) {
    urls = Array(urls).compact_blank.uniq
    urls.empty? ? none : complete.where(public_url: urls).where.not(variants: {})
  }
  scope :pending, -> { where(status: "pending") }

  def self.sanitize_filename(name)
    base = File.basename(name.to_s).gsub(/[^A-Za-z0-9_.-]/, "_").gsub(/\A[._]+/, "").last(120)
    base.presence || "upload-#{SecureRandom.hex(6)}"
  end

  # Uploads nothing uses: no portfolio item, profile photo or act photo points at them (by url, thumbnail or waveform), no
  # resume attaches them and no application sent them as a resume PDF (see
  # Application.materials_snapshot), so an employer's copy keeps working after the resume changes.
  def self.unreferenced
    where(<<~SQL.squish)
      (uploads.public_url IS NULL OR NOT EXISTS (
        SELECT 1 FROM portfolio_items p
        WHERE p.url = uploads.public_url OR p.thumbnail_url = uploads.public_url OR p.waveform_url = uploads.public_url
      ))
      AND (uploads.public_url IS NULL OR NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.photo_url = uploads.public_url))
      AND (uploads.public_url IS NULL OR NOT EXISTS (SELECT 1 FROM acts a WHERE a.photo_url = uploads.public_url))
      AND NOT EXISTS (SELECT 1 FROM resumes r WHERE r.upload_id = uploads.id)
      AND NOT EXISTS (SELECT 1 FROM posts po WHERE po.status <> 'deleted' AND po.media @> jsonb_build_array(jsonb_build_object('uploadId', uploads.id)))
      AND NOT EXISTS (
        SELECT 1 FROM applications a
        WHERE a.materials_snapshot IS NOT NULL AND (a.materials_snapshot #>> '{resume,uploadId}') = uploads.id
      )
    SQL
  end

  PHOTO_TYPES = %w[image/jpeg image/png image/webp].freeze
  PHOTO_MAX_SIZE = 5.megabytes

  # True when `url` is the public URL of a finished jpeg/png/webp upload owned by `user`: the
  # only URLs a profile or act photo may point at (besides the one it already has).
  def self.photo_owned_by?(user, url)
    return false if user.nil? || url.blank?
    complete.where(user_id: user.id, content_type: PHOTO_TYPES, public_url: url).where(byte_size: ..PHOTO_MAX_SIZE).exists?
  end

  def complete? = status == "complete"

  def image? = ImageVariants.image?(content_type)
  def audio? = AudioVariants.audio?(content_type)

  # Variants are generated for finished images in the bucket; disk (development) uploads and every
  # other media type keep serving the original alone.
  def variants_possible? = complete? && image? && storage == "s3" && public_url.present?

  # Audio variants (preview clip, peaks, AAC transcode) are generated for finished bucket audio files
  # of the types in config/audio.yml; disk uploads keep serving the original alone.
  def audio_variants_possible? = complete? && audio? && storage == "s3" && public_url.present?

  # Public URL of one generated variant (ImageVariantsJob), or nil when that width x format was not
  # produced. Built from the URL the upload was issued with, so a later change of the read domain
  # (UPLOADS_PUBLIC_BASE_URL) leaves old rows pointing where their original still is.
  def variant_url(width, format)
    widths = variants.is_a?(Hash) ? Array(variants.dig("formats", format.to_s)) : []
    return nil unless widths.include?(width.to_i) && public_url.to_s.end_with?(key)
    public_url.delete_suffix(key) + ImageVariants.variant_key(key, width.to_i, format)
  end

  # The responsive-image payload (ImageSet), or nil without variants.
  def image_set = ImageSet.for(self)

  # Public URL of one generated audio variant (AudioVariantsJob: "preview", "full", "peaks"), or nil
  # when it was not produced. Same URL rule as variant_url.
  def audio_variant_url(name)
    produced = variants.is_a?(Hash) ? Array(variants.dig("audio", "variants")) : []
    return nil unless produced.include?(name.to_s) && public_url.to_s.end_with?(key)
    public_url.delete_suffix(key) + AudioVariants.variant_key(key, name.to_s)
  end

  # The audio payload (AudioSet), or nil without audio variants.
  def audio_set = AudioSet.for(self)

  # Bucket keys of the generated variants (image and audio), for deletion with the original.
  def variant_keys
    return [] unless variants.is_a?(Hash)
    Hash(variants["formats"]).flat_map { |format, widths| Array(widths).map { ImageVariants.variant_key(key, _1, format) } } +
      Array(variants.dig("audio", "variants")).map { AudioVariants.variant_key(key, _1) }
  end

  def referenced?
    (public_url.present? && PortfolioItem.where(url: public_url).or(PortfolioItem.where(thumbnail_url: public_url)).or(PortfolioItem.where(waveform_url: public_url)).exists?) ||
      (public_url.present? && (Profile.exists?(photo_url: public_url) || Act.exists?(photo_url: public_url))) ||
      Resume.exists?(upload_id: id) ||
      Post.where.not(status: "deleted").where("media @> ?", [{ uploadId: id }].to_json).exists? ||
      Application.where.not(materials_snapshot: nil).where("(materials_snapshot #>> '{resume,uploadId}') = ?", id).exists?
  end

  # Deletes the stored object, then the row. Safe to repeat.
  def purge!
    UploadStorage.delete(storage, key, variant_keys)
    destroy!
  end

  def api_json = { id:, url: public_url, status:, contentType: content_type, byteSize: byte_size, filename:, image: image_set, audio: audio_set }
end
