# A person follows another identity: a person, an organization or an act. A Page
# cannot follow anyone itself; follower_user_id is always the real person.
class Follow < ApplicationRecord
  FOLLOWABLE_TYPES = %w[user organization act].freeze

  belongs_to :follower, class_name: "User", foreign_key: :follower_user_id

  validates :followable_type, inclusion: { in: FOLLOWABLE_TYPES }
  validates :followable_id, presence: true
  validates :followable_id, uniqueness: { scope: %i[follower_user_id followable_type], message: "is already followed" }
  validate :not_following_self

  scope :for_follower, ->(user_id) { where(follower_user_id: user_id) }
  scope :for_followable, ->(type, id) { where(followable_type: type, followable_id: id) }

  private

  def not_following_self
    errors.add(:followable_id, "cannot be yourself") if followable_type == "user" && followable_id == follower_user_id
  end
end
