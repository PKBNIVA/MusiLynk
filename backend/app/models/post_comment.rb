# A comment on a post, authored as a person or a Page (see Post for the same
# author_type/author_id + created_by_user_id convention). One level of replies via parent_id.
class PostComment < ApplicationRecord
  BODY_LIMIT = 1_000
  STATUSES = %w[active hidden deleted].freeze

  belongs_to :post
  belongs_to :created_by, class_name: "User", foreign_key: :created_by_user_id
  belongs_to :parent, class_name: "PostComment", foreign_key: :parent_id, optional: true
  has_many :replies, class_name: "PostComment", foreign_key: :parent_id, inverse_of: :parent

  validates :author_type, inclusion: { in: Post::AUTHOR_TYPES }
  validates :author_id, presence: true
  validates :body, presence: true, length: { maximum: BODY_LIMIT }
  validates :status, inclusion: { in: STATUSES }
  validate :parent_belongs_to_same_post, if: -> { parent_id.present? }
  validate :parent_has_no_parent, if: -> { parent_id.present? }

  scope :visible, -> { where(status: "active") }

  def active? = status == "active"

  def editable_by?(actor)
    return false unless actor
    actor.type == author_type && actor.id == author_id
  end

  def author_name
    case author_type
    when "organization" then Organization.find_by(id: author_id)&.name
    when "act" then Act.find_by(id: author_id)&.name
    else created_by&.name
    end
  end

  def api_json
    {
      id: id, postId: post_id,
      author: { type: author_type, id: author_id, name: author_name },
      body: body, status: status, parentId: parent_id,
      createdAt: created_at, updatedAt: updated_at
    }
  end

  private

  def parent_belongs_to_same_post
    errors.add(:parent_id, "must be a comment on the same post") unless parent && parent.post_id == post_id
  end

  def parent_has_no_parent
    errors.add(:parent_id, "replies can only be one level deep") if parent&.parent_id.present?
  end
end
