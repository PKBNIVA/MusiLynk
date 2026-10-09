class PortfolioItem < ApplicationRecord
  include SearchIndexed
  search_document "samples", fields: %i[title tags roles genres instruments credited_as description]
  MEDIA_URL_ATTRIBUTES = %w[url thumbnail_url waveform_url].freeze
  # Hosts that serve bucket objects directly; links there must be the user's own upload.
  SYNC_ATTRIBUTES = %w[title description credited_as kind year tags genres roles instruments].freeze
  STORAGE_HOST_SUFFIXES = %w[.r2.cloudflarestorage.com .r2.dev .amazonaws.com].freeze

  belongs_to :user
  attribute :tags, :json, default: -> { [] }
  attribute :genres, :json, default: -> { [] }
  attribute :roles, :json, default: -> { [] }
  attribute :instruments, :json, default: -> { [] }
  attribute :media_metadata, :json, default: -> { {} }
  validates :title, :kind, :url, presence: true
  validates :url, :thumbnail_url, :waveform_url, safe_http_url: true, allow_blank: true
  validate :media_urls_are_external_or_own_uploads

  # Uploaded objects are deleted once no work sample refers to them any more.
  after_update_commit -> { release_uploads(previous_changes.slice(*MEDIA_URL_ATTRIBUTES).values.map(&:first)) }
  after_destroy_commit -> { release_uploads(attributes.values_at(*MEDIA_URL_ATTRIBUTES)) }
  # Portfolios are views over the library: re-evaluate them when an item is added or its
  # describing fields change (see ShowcaseSync).
  after_commit -> { ShowcaseSync.item(self) }, on: :create
  after_commit -> { ShowcaseSync.item(self) if (previous_changes.keys & SYNC_ATTRIBUTES).any? }, on: :update
  after_destroy_commit -> { ShowcaseSync.forget_item(id) }
  # A playable public sample and having any sample at all both feed the owner's rank (TalentRank).
  RANK_ATTRIBUTES = %w[user_id kind visibility url].freeze
  after_commit -> { TalentRank.refresh!([user_id]) }, on: %i[create destroy]
  after_commit -> { TalentRank.refresh!(previous_changes.fetch("user_id", [user_id]) | [user_id]) if (previous_changes.keys & RANK_ATTRIBUTES).any? }, on: :update

  # `image` is the responsive payload (ImageSet) of an uploaded image sample, `thumbnail` that of an
  # uploaded thumbnail, `audio` the preview/peaks payload (AudioSet) of an uploaded audio sample; all
  # nil for links and uploads without variants. Call PortfolioItem.preload_image_sets on a list first,
  # or each item costs a lookup.
  def api_json = attributes.transform_keys { _1.camelize(:lower) }.merge(type: kind, image: image_sets[url], thumbnail: image_sets[thumbnail_url], audio: audio_sets[url])

  # Resolves the variants of every item's image, thumbnail and audio URLs in one query (or hands the
  # items lookups already made, `sets` and `audio`, so a page can resolve them together with other
  # URLs; see TalentController#public_show). Returns the items.
  def self.preload_image_sets(items, sets: nil, audio: nil)
    items = Array(items)
    if sets.nil? && audio.nil?
      uploads = Upload.variants_by_url(image_urls(items) + audio_urls(items)).to_a
      sets = ImageSet.from_uploads(uploads)
      audio = AudioSet.from_uploads(uploads)
    end
    sets ||= ImageSet.by_url(image_urls(items))
    audio ||= AudioSet.by_url(audio_urls(items))
    items.each do |item|
      item.instance_variable_set(:@image_sets, sets)
      item.instance_variable_set(:@audio_sets, audio)
    end
  end

  # The URLs whose variants api_json needs: uploaded image samples and uploaded thumbnails.
  def self.image_urls(items) = Array(items).flat_map { [_1.kind == "image" ? _1.url : nil, _1.thumbnail_url] }.compact_blank
  # The URLs whose audio variants api_json needs: uploaded audio samples (links are skipped by the lookup).
  def self.audio_urls(items) = Array(items).filter_map { _1.url if _1.kind == "audio" }.compact_blank

  def image_sets
    return @image_sets if defined?(@image_sets)
    @image_sets = ImageSet.by_url([kind == "image" ? url : nil, thumbnail_url])
  end

  def audio_sets
    return @audio_sets if defined?(@audio_sets)
    @audio_sets = AudioSet.by_url([kind == "audio" ? url : nil])
  end

  def self.storage_url?(value)
    uri = URI.parse(value.to_s)
    host = uri.host.to_s.downcase
    return false if host.empty?
    base_host = UploadStorage.public_base_url && URI.parse(UploadStorage.public_base_url).host.to_s.downcase
    api_host = ENV["API_HOST"].present? ? URI.parse(ENV["API_HOST"]).host.to_s.downcase : nil
    host == base_host ||
      (uri.path.to_s.start_with?("/rails/active_storage/") && (api_host.nil? || host == api_host)) ||
      (STORAGE_HOST_SUFFIXES.any? { host.end_with?(_1) } && uri.path.to_s.include?("/#{UploadStorage::KEY_PREFIX}"))
  rescue URI::InvalidURIError
    false
  end

  private

  def media_urls_are_external_or_own_uploads
    MEDIA_URL_ATTRIBUTES.each do |attribute|
      value = self[attribute].to_s
      next if value.blank? || !will_save_change_to_attribute?(attribute)
      next unless value.match?(%r{\Ahttps?://}i) # other schemes are rejected by SafeHttpUrlValidator

      upload = Upload.find_by(public_url: value)
      if upload || self.class.storage_url?(value)
        next if upload && upload.user_id == user_id && upload.complete?
        errors.add(attribute, "must be one of your own completed uploads")
      elsif !value.match?(%r{\Ahttps://}i)
        errors.add(attribute, "must be an HTTPS link (YouTube, Spotify, SoundCloud or another secure page)")
      end
    end
  end

  def release_uploads(urls)
    urls = urls.compact_blank.uniq
    UploadCleanupJob.perform_later(urls) if urls.any? && Upload.where(public_url: urls).exists?
  end
end
