# One row per lifecycle/digest/milestone email actually sent, keyed by (user, key). The
# unique index is the idempotency guard: `record!` returns false instead of raising when
# the key was already recorded, so callers can `next unless LifecycleEmail.record!(...)`
# right before enqueuing the send.
class LifecycleEmail < ApplicationRecord
  belongs_to :user

  validates :key, presence: true

  # Digest keys look like "digest:2026-W40" (ISO week) so a user gets at most one digest
  # per calendar week regardless of how many times the job runs that day.
  def self.digest_key(date = Time.current) = "digest:#{date.strftime('%G-W%V')}"

  # Atomically claims (user, key). Returns true the first time, false on every later call
  # for the same pair (including races: relies on the DB unique index, not a prior SELECT).
  def self.record!(user, key)
    create!(user:, key:, sent_at: Time.current)
    true
  rescue ActiveRecord::RecordNotUnique
    false
  end

  # Stamps delivered_at once the provider accepted the message (LifecycleEmailDeliveryJob).
  # A no-op when no row was claimed for the pair, and idempotent on a retry.
  def self.mark_delivered!(user_id, key)
    where(user_id:, key:, delivered_at: nil).update_all(delivered_at: Time.current)
  end

  def self.sent?(user, key) = exists?(user_id: user.id, key:)
end
