# The Stage: a community feed post, authored by a person or a Page they run
# (author_type/author_id — resolved through ActorResolver, "user"/"organization"/"act").
# created_by_user_id is always the real person who wrote it, kept for audit and
# moderation even when the post is made as a Page.
class Post < ApplicationRecord
  AUTHOR_TYPES = %w[user organization act].freeze
  KINDS = %w[update performance release gig looking_for job_share portfolio_share].freeze
  VISIBILITIES = %w[public followers].freeze
  STATUSES = %w[active hidden deleted].freeze
  MEDIA_TYPES = %w[image audio video].freeze
  BODY_LIMIT = 3_000
  MEDIA_LIMIT = 10
  HASHTAG_PATTERN = /#([a-z0-9_]{2,50})/i
  TRENDING_WINDOW = 72.hours

  belongs_to :created_by, class_name: "User", foreign_key: :created_by_user_id
  belongs_to :shared_portfolio_item, class_name: "PortfolioItem", foreign_key: :shared_portfolio_item_id, optional: true
  belongs_to :shared_job, class_name: "Job", foreign_key: :shared_job_id, optional: true
  belongs_to :reshared_post, class_name: "Post", foreign_key: :reshared_post_id, optional: true
  has_many :post_reactions, dependent: :destroy
  has_many :post_comments, dependent: :destroy
  has_many :reshares, class_name: "Post", foreign_key: :reshared_post_id, inverse_of: :reshared_post

  attribute :media, :json, default: -> { [] }

  validates :author_type, inclusion: { in: AUTHOR_TYPES }
  validates :author_id, presence: true
  validates :created_by_user_id, presence: true
  validates :kind, inclusion: { in: KINDS }
  validates :visibility, inclusion: { in: VISIBILITIES }
  validates :status, inclusion: { in: STATUSES }
  validates :body, length: { maximum: BODY_LIMIT }, allow_nil: true
  validates :link_url, safe_http_url: true, allow_blank: true
  validate :body_or_share_present
  validate :media_is_well_formed
  validate :shared_portfolio_item_is_owned_by_author, if: -> { kind == "portfolio_share" }
  validate :shared_job_is_open, if: -> { kind == "job_share" }
  validate :reshared_post_is_visible, if: -> { reshared_post_id.present? }

  before_validation :extract_hashtags

  scope :visible, -> { where(status: "active") }
  scope :by_author, ->(type, id) { where(author_type: type, author_id: id) }

  def self.extract_hashtags(body)
    body.to_s.scan(HASHTAG_PATTERN).flatten.map(&:downcase).uniq
  end

  def author_actor = ActorResolver::Actor.new(type: author_type, id: author_id, name: author_name, record: author_record, user: created_by)

  def author_record
    case author_type
    when "organization" then Organization.find_by(id: author_id)
    when "act" then Act.find_by(id: author_id)
    else User.find_by(id: author_id)
    end
  end

  def author_name
    record = author_record
    return record&.name if record
    created_by&.name
  end

  def author_verified?
    case author_type
    when "organization" then false
    when "act" then false
    else created_by&.profile&.verified || false
    end
  end

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
      author: { type: author_type, id: author_id, name: author_name, avatar: author_avatar, verified: author_verified? },
      kind: kind,
      body: body,
      media: Array(media),
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
      createdAt: created_at,
      updatedAt: updated_at
    }
  end

  def shared_entity_preview
    return reshared_post_preview if reshared_post_id.present?

    case kind
    when "portfolio_share" then shared_portfolio_item && { type: "portfolio_item", item: shared_portfolio_item.api_json }
    when "job_share" then shared_job && { type: "job", job: shared_job.api_json, applyOpen: shared_job.listed? }
    end
  end

  private

  def reshared_post_preview
    return nil unless reshared_post
    { type: "post", post: reshared_post.api_json }
  end

  def author_avatar
    nil
  end

  def extract_hashtags
    self.hashtags = self.class.extract_hashtags(body)
  end

  def body_or_share_present
    return if body.present? || shared_portfolio_item_id.present? || shared_job_id.present? || reshared_post_id.present?
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
    errors.add(:shared_job_id, "is not open") unless job.listed?
  end

  def reshared_post_is_visible
    original = reshared_post
    return errors.add(:reshared_post_id, "was not found") unless original
    errors.add(:reshared_post_id, "is not available") unless original.active?
  end
end
