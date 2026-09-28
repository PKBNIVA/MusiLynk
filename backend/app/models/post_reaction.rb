# An "Applause" from an actor (person or Page) on a post. Unique per actor per post.
class PostReaction < ApplicationRecord
  KINDS = %w[applause].freeze

  belongs_to :post

  validates :actor_type, inclusion: { in: Post::AUTHOR_TYPES }
  validates :actor_id, presence: true
  validates :kind, inclusion: { in: KINDS }
  validates :actor_id, uniqueness: { scope: %i[post_id actor_type], message: "has already reacted to this post" }
end
