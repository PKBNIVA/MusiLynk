# A third-party sign-in / API identity linked to a Verse owner (a User today; a Page —
# Organization or Act — later). One row per (provider, provider_uid): Google sign-in creates
# and reads these, and the account settings "sign-in methods" section lists and removes them
# (AuthController#connections / #destroy_connection).
class AuthConnection < ApplicationRecord
  PROVIDERS = %w[google youtube spotify instagram].freeze

  belongs_to :owner, polymorphic: true

  encrypts :access_token, deterministic: false
  encrypts :refresh_token, deterministic: false

  validates :provider, presence: true, inclusion: { in: PROVIDERS }
  validates :provider_uid, presence: true, uniqueness: { scope: :provider }

  scope :google, -> { where(provider: "google") }

  # A connection can change a pending verification request's evidence score.
  after_commit -> { Verification::RescoreJob.for_user(owner_id) if owner_type == "User" }

  def as_summary
    { id:, provider:, email:, displayName: display_name, connectedAt: created_at }
  end
end
