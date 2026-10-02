# One browser/device a user allowed web push on (see PushNotifications). The endpoint and keys
# are secrets: encrypted at rest, never logged, never returned by the API.
class PushSubscription < ApplicationRecord
  # Dropped for good after this many consecutive failed sends (a dead device that never answered 404/410).
  MAX_FAILURES = 8
  # A subscription that has failed is skipped until 2**failure_count minutes after its last failure (see .sendable).

  belongs_to :user

  encrypts :endpoint, deterministic: false
  encrypts :p256dh, deterministic: false
  encrypts :auth, deterministic: false

  before_validation { self.endpoint_digest = self.class.digest(endpoint) if endpoint.present? }

  validates :endpoint, presence: true, length: { maximum: 2_000 }
  validates :p256dh, presence: true, length: { maximum: 200 }
  validates :auth, presence: true, length: { maximum: 100 }
  validates :endpoint_digest, uniqueness: true
  validate :endpoint_is_a_push_service
  validate :keys_are_well_formed

  def self.digest(endpoint) = Digest::SHA256.hexdigest(endpoint.to_s)

  def self.find_by_endpoint(endpoint) = find_by(endpoint_digest: digest(endpoint))

  # Subscriptions that are not currently backing off after failures.
  def self.sendable
    where(failure_count: 0).or(where("last_failure_at IS NULL OR last_failure_at < now() - (power(2, failure_count) * interval '2 minutes')"))
  end

  def record_success!
    update_columns(last_success_at: Time.current, failure_count: 0, last_failure_at: nil, updated_at: Time.current)
  end

  # Returns true when the subscription was dropped for failing too often.
  def record_failure!
    count = failure_count + 1
    if count >= MAX_FAILURES
      destroy
      return true
    end

    update_columns(failure_count: count, last_failure_at: Time.current, updated_at: Time.current)
    false
  end

  private

  def keys_are_well_formed
    errors.add(:p256dh, "is not a valid P-256 public key") if p256dh.present? && !PushNotifications.valid_p256dh?(p256dh)
    errors.add(:auth, "is not a valid auth secret") if auth.present? && !PushNotifications.valid_auth?(auth)
  end

  def endpoint_is_a_push_service
    errors.add(:endpoint, "is not a supported push service") if endpoint.present? && !PushNotifications.valid_endpoint?(endpoint)
  end
end
