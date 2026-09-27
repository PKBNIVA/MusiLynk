class UserBlock < ApplicationRecord
  belongs_to :blocker, class_name: "User"
  belongs_to :blocked, class_name: "User"

  validate :not_self

  # True when either user has blocked the other.
  def self.between?(a, b)
    where(blocker_id: a.id, blocked_id: b.id).or(where(blocker_id: b.id, blocked_id: a.id)).exists?
  end

  private

  def not_self
    errors.add(:blocked, "cannot be yourself") if blocker_id.present? && blocker_id == blocked_id
  end
end
