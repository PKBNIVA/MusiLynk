# The Stage: a community feed post, authored by a person or a Page they run
# (author_type/author_id — resolved through ActorResolver, "user"/"organization"/"act").
# created_by_user_id is always the real person who wrote it, kept for audit and
# moderation even when the post is made as a Page.
class Post < ApplicationRecord
  # "system" is the platform's own author (Post::SYSTEM_AUTHOR_ID) — StageSystemPostsJob and
  # FastResponderWeekJob post as it; created_by_user_id is nil for those posts.
  AUTHOR_TYPES = %w[user organization act system].freeze
  KINDS = %w[update performance release gig looking_for job_share portfolio_share system event].freeze
  VISIBILITIES = %w[public followers].freeze
  STATUSES = %w[active hidden deleted].freeze
  MEDIA_TYPES = %w[image audio video].freeze
  # What a system post announces (Post#system_kind); used for aggregation/idempotency, not display.
  SYSTEM_KINDS = %w[welcome welcome_aggregate verified urgent_filled weekly_roundup fastest_responders].freeze
  BODY_LIMIT = 3_000
  MEDIA_LIMIT = 10
  # Letters, combining marks (Devanagari vowel signs and the like), digits and underscores, 2-50
  # characters. src/app/lib/stage.ts HASHTAG_PATTERN must stay identical.
  HASHTAG_PATTERN = /#([\p{L}\p{M}\p{N}_]{2,50})/
  TRENDING_WINDOW = 72.hours
  SYSTEM_AUTHOR_ID = "musilynk".freeze
  # The id before the MusiLynk rename. Old shared links (/stage/authors/system/verse) still resolve;
  # see .canonical_author_id. Remove after 2026-11-01 together with the other rename fallbacks.
  LEGACY_SYSTEM_AUTHOR_ID = "verse".freeze
  SYSTEM_AUTHOR_NAME = Brand::NAME.freeze
  SYSTEM_AVATAR = "/musilynk-mark.svg".freeze

  def self.canonical_author_id(type, id)
    type.to_s == "system" && id.to_s == LEGACY_SYSTEM_AUTHOR_ID ? SYSTEM_AUTHOR_ID : id
  end

  belongs_to :created_by, class_name: "User", foreign_key: :created_by_user_id, optional: true
  belongs_to :shared_portfolio_item, class_name: "PortfolioItem", foreign_key: :shared_portfolio_item_id, optional: true
  belongs_to :shared_job, class_name: "Job", foreign_key: :shared_job_id, optional: true
  belongs_to :reshared_post, class_name: "Post", foreign_key: :reshared_post_id, optional: true
  has_many :post_reactions, dependent: :destroy
  has_many :post_comments, dependent: :destroy
  has_many :reshares, class_name: "Post", foreign_key: :reshared_post_id, inverse_of: :reshared_post

  attribute :media, :json, default: -> { [] }

  validates :author_type, inclusion: { in: AUTHOR_TYPES }
  validates :author_id, presence: true
  validates :created_by_user_id, presence: true, unless: -> { author_type == "system" }
  validates :kind, inclusion: { in: KINDS }
  validates :visibility, inclusion: { in: VISIBILITIES }
  validates :status, inclusion: { in: STATUSES }
  validates :body, length: { maximum: BODY_LIMIT }, allow_nil: true
  validates :link_url, safe_http_url: true, allow_blank: true
  validates :system_kind, inclusion: { in: SYSTEM_KINDS }, if: -> { kind == "system" }
  validates :event_title, :event_starts_at, :event_venue, presence: true, if: -> { kind == "event" }
  # These only make sense at creation time: the shared portfolio item, job or original post
  # can legitimately disappear later (deleted, closed, taken down) — the FK on those columns
  # is ON DELETE SET NULL for exactly that reason, and the post then renders an "unavailable"
  # shared preview (see #shared_entity_preview) instead of failing later, unrelated edits.
  validate :body_or_share_present, on: :create
  validate :media_is_well_formed
  validate :shared_portfolio_item_is_owned_by_author, on: :create, if: -> { kind == "portfolio_share" }
  validate :shared_job_is_open, on: :create, if: -> { kind == "job_share" }
  validate :reshared_post_is_visible, on: :create, if: -> { reshared_post_id.present? }

  before_validation :extract_hashtags

  scope :visible, -> { where(status: "active") }
  scope :by_author, ->(type, id) { where(author_type: type, author_id: id) }
  scope :pinned, -> { where("pinned_until IS NOT NULL AND pinned_until > ?", Time.current) }
  # Pinned-and-current posts first (most recently pinned first), then everything else by recency —
  # the ordering the Stage feed and StageSystemPostsJob rely on to show the weekly pinned post on top.
  scope :pinned_first, -> { order(Arel.sql("(pinned_until IS NOT NULL AND pinned_until > NOW()) DESC"), created_at: :desc, id: :desc) }
  scope :upcoming_events, ->(city: nil) {
    scope = where(kind: "event", visibility: "public").where("event_starts_at >= ?", Time.current).visible
    scope = scope.where(city: city) if city.present?
    scope.order(featured: :desc, event_starts_at: :asc)
  }

  def self.extract_hashtags(body)
    body.to_s.scan(HASHTAG_PATTERN).flatten.map(&:downcase).uniq
  end

  def author_actor = ActorResolver::Actor.new(type: author_type, id: author_id, name: author_name, record: author_record, user: created_by)

  def author_record
    return @author_record if defined?(@author_record)
    @author_record = case author_type
    when "organization" then Organization.find_by(id: author_id)
    when "act" then Act.find_by(id: author_id)
    when "system" then nil
    else User.find_by(id: author_id)
    end
  end

  def author_name
    return SYSTEM_AUTHOR_NAME if author_type == "system"
    record = author_record
    return record&.name if record
    created_by&.name
  end

  def author_verified?
    case author_type
    when "organization", "act", "system" then false
    else created_by&.profile&.verified || false
    end
  end

  def pinned? = pinned_until.present? && pinned_until > Time.current

  def active? = status == "active"
  def deleted? = status == "deleted"

  # Whether `actor` (an ActorResolver::Actor, or nil) may manage (edit/delete) this post.
  def editable_by?(actor)
    return false unless actor
    actor.type == author_type && actor.id == author_id
  end

  def api_json(viewer_user_id: nil, applauded_post_ids: Set.new)
    {
      id: id,
      author: { type: author_type, id: author_id, name: author_name, avatar: author_avatar, verified: author_verified?, system: author_type == "system" },
      kind: kind,
      body: body,
      media: media_json,
      linkUrl: link_url,
      city: city,
      genres: Array(genres),
      hashtags: Array(hashtags),
      visibility: visibility,
      status: status,
      sharedEntity: shared_entity_preview,
      applauseCount: applause_count,
      commentCount: comment_count,
      reshareCount: reshare_count,
      applauded: applauded_post_ids.include?(id),
      pinned: pinned?,
      pinnedUntil: pinned_until,
      event: event_json,
      createdAt: created_at,
      updatedAt: updated_at
    }
  end

  # The stored media entries ({uploadId, type, caption}) plus each one's public `url`, looked up
  # from the finished Upload the author owns, so every viewer (not just the uploading browser
  # session) can render the file.
  def media_json
    items = Array(media).map { _1.is_a?(Hash) ? _1.stringify_keys : _1 }
    return items if items.empty? || created_by_user_id.blank?
    urls = @media_urls || Post.media_urls_for([self])
    items.map { |item| item.is_a?(Hash) && urls[item["uploadId"]].present? ? item.merge("url" => urls[item["uploadId"]]) : item }
  end

  # Resolves the media urls of a whole page of posts in one query, so serialising N posts does
  # not run N Upload lookups. Call before api_json on each; returns the posts.
  # Loads every post's author record (person, Page or act) in one query per author type, so
  # api_json on a page of posts does not look each author up separately. A person's own post
  # reuses the already-loaded created_by user.
  def self.preload_authors(posts)
    pending = posts.reject { _1.instance_variable_defined?(:@author_record) || _1.author_type == "system" }
    pending.select { _1.author_type == "user" && _1.created_by_user_id == _1.author_id && _1.association(:created_by).loaded? }.each do |post|
      post.instance_variable_set(:@author_record, post.created_by)
    end
    pending.reject { _1.instance_variable_defined?(:@author_record) }.group_by(&:author_type).each do |type, group|
      model = { "organization" => Organization, "act" => Act }.fetch(type, User)
      records = model.where(id: group.map(&:author_id).uniq).index_by(&:id)
      group.each { _1.instance_variable_set(:@author_record, records[_1.author_id]) }
    end
  end

  # Loads the jobs shared by `posts` in one query, with what Job#api_json reads (employer and
  # profile, posted-as Page, applications count), so a page of job shares costs no query per post.
  def self.preload_shared_jobs(posts)
    sharing = posts.select(&:shared_job_id)
    return if sharing.empty?
    ActiveRecord::Associations::Preloader.new(records: sharing, associations: :shared_job, scope: Job.with_applications_count).call
    jobs = sharing.filter_map(&:shared_job).uniq
    ActiveRecord::Associations::Preloader.new(records: jobs, associations: [:posted_as_organization, :posted_as_act, { employer: :profile }]).call
  end

  def self.preload_media_urls(posts)
    urls = media_urls_for(posts)
    posts.each { _1.instance_variable_set(:@media_urls, urls) }
  end

  # {upload_id => public_url} for the finished uploads that the posts' own authors attached.
  def self.media_urls_for(posts)
    pairs = posts.filter_map do |post|
      next if post.created_by_user_id.blank?
      Array(post.media).filter_map { |item| [item["uploadId"] || item[:uploadId], post.created_by_user_id] if item.is_a?(Hash) }
    end.flatten(1).reject { _1.first.blank? }
    return {} if pairs.empty?
    Upload.complete.where(id: pairs.map(&:first).uniq, user_id: pairs.map(&:last).uniq).pluck(:id, :user_id, :public_url)
      .select { |id, user_id, _| pairs.include?([id, user_id]) }.to_h { |id, _, url| [id, url] }
  end

  def event_json
    return nil unless kind == "event"
    { title: event_title, startsAt: event_starts_at, venue: event_venue, city: city, link: link_url, featured: featured }
  end

  # ICS ("iCalendar") text for this event post's calendar-download link.
  def to_ics
    return nil unless kind == "event"
    dtstamp = created_at.utc.strftime("%Y%m%dT%H%M%SZ")
    dtstart = event_starts_at.utc.strftime("%Y%m%dT%H%M%SZ")
    lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MusiLynk//Stage Events//EN", "BEGIN:VEVENT",
      "UID:#{id}@musilynk", "DTSTAMP:#{dtstamp}", "DTSTART:#{dtstart}",
      "SUMMARY:#{ics_escape(event_title)}", "LOCATION:#{ics_escape([event_venue, city].compact.join(', '))}"
    ]
    lines << "DESCRIPTION:#{ics_escape(body)}" if body.present?
    lines << "URL:#{ics_escape(link_url)}" if link_url.present?
    lines << "END:VEVENT" << "END:VCALENDAR"
    lines.join("\r\n")
  end

  # A post that shared something keeps its `shared_*_id`/`reshared_post_id` for its own
  # lifetime, even after the thing it pointed at is gone (the FK sets the column to null on
  # delete — see the migrations): the preview then degrades to "unavailable" instead of the
  # request failing, so the post itself (and any body the person added) still renders. A
  # reshare whose original post is gone simply has no `reshared_post_id` left to show; the
  # post still renders, just without a shared preview.
  def shared_entity_preview
    return reshared_post_preview if reshared_post_id.present?

    case kind
    when "portfolio_share" then shared_item_public? ? { type: "portfolio_item", item: public_item_json(shared_portfolio_item) } : unavailable("portfolio_item")
    when "job_share" then shared_job&.published? && !shared_job.employer.deleted? ? { type: "job", job: shared_job.api_json, applyOpen: true } : unavailable("job")
    end
  end

  private

  # Only a work sample that is public right now, by an account that is still active.
  def shared_item_public?
    item = shared_portfolio_item
    item.present? && item.visibility == "public" && item.user.active?
  end

  # The public view of a work sample: what its own profile page shows, not internal columns.
  PUBLIC_ITEM_FIELDS = %w[id user_id kind title url credited_as thumbnail_url waveform_url description tags genres roles instruments year featured].freeze

  def public_item_json(item)
    item.attributes.slice(*PUBLIC_ITEM_FIELDS).transform_keys { _1.camelize(:lower) }.merge("type" => item.kind)
  end

  def reshared_post_preview
    # Only a public, live original is embedded: a reshare is itself public, so a followers-only,
    # hidden (moderated) or deleted original must not be readable through it.
    reshared_post&.then { _1.active? && _1.visibility == "public" } ? { type: "post", post: reshared_post.api_json } : unavailable("post")
  end

  def unavailable(type) = { type:, unavailable: true }

  def author_avatar
    return SYSTEM_AVATAR if author_type == "system"
    case author_type
    when "organization" then nil
    when "act" then author_record&.photo_url.presence
    else created_by&.profile&.photo_url.presence
    end
  end

  def ics_escape(text) = text.to_s.gsub(/([,;\\])/, '\\\\\1').gsub("\n", "\\n")

  def extract_hashtags
    self.hashtags = self.class.extract_hashtags(body)
  end

  def body_or_share_present
    return if kind == "event" || body.present? || shared_portfolio_item_id.present? || shared_job_id.present? || reshared_post_id.present?
    errors.add(:body, "or a shared item is required")
  end

  def media_is_well_formed
    items = Array(media)
    return errors.add(:media, "can include at most #{MEDIA_LIMIT} items") if items.length > MEDIA_LIMIT
    items.each do |item|
      item = item.is_a?(Hash) ? item.stringify_keys : {}
      errors.add(:media, "must include an upload id") and next if item["uploadId"].blank?
      errors.add(:media, "type must be image, audio or video") unless MEDIA_TYPES.include?(item["type"])
    end
  end

  def shared_portfolio_item_is_owned_by_author
    errors.add(:shared_portfolio_item_id, "is required") and return if shared_portfolio_item_id.blank?
    item = shared_portfolio_item
    return errors.add(:shared_portfolio_item_id, "was not found") unless item
    return if author_type == "user" && item.user_id == author_id
    errors.add(:shared_portfolio_item_id, "must be one of your own portfolio items")
  end

  def shared_job_is_open
    errors.add(:shared_job_id, "is required") and return if shared_job_id.blank?
    job = shared_job
    return errors.add(:shared_job_id, "was not found") unless job
    errors.add(:shared_job_id, "must be one of your own published opportunities") unless job.published? && job.employer_id == created_by_user_id
  end

  def reshared_post_is_visible
    original = reshared_post
    return errors.add(:reshared_post_id, "was not found") unless original
    errors.add(:reshared_post_id, "is not available") unless original.active? && original.visibility == "public"
  end
end
