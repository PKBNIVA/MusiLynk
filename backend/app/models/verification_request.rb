class VerificationRequest < ApplicationRecord
  # What the admin actually checked before approving (Admin::VerificationsController#update).
  # Shown on the public Verified badge's tooltip so "Verified" says what it means.
  CHECKS = %w[identity work_links credits organization].freeze

  belongs_to :user
  belongs_to :reviewed_by, class_name: "User", optional: true
  validates :kind, inclusion: { in: %w[professional organization] }
  validates :evidence_url, safe_http_url: true, allow_blank: true
  validate :checks_are_known

  private

  def checks_are_known
    errors.add(:checks, "must be one of #{CHECKS.join(', ')}") if Array(checks).any? { !CHECKS.include?(_1) }
  end
end
