# Referral without cash: a verified musician vouches for someone by email. invited -> joined
# (the invitee signs up through the token link, which stamps users.vouched_by_id) -> verified
# (their own verification request is later approved). See VouchesController and
# Admin::VerificationsController#update (which sorts vouched applicants first and promotes
# joined -> verified on approval).
class Vouch < ApplicationRecord
  STATUSES = %w[invited joined verified].freeze
  MAX_ACTIVE_PER_VOUCHER = 3

  belongs_to :voucher, class_name: "User"
  belongs_to :vouchee, class_name: "User", optional: true

  validates :vouchee_email, presence: true, format: { with: URI::MailTo::EMAIL_REGEXP }
  validates :status, inclusion: { in: STATUSES }
  validates :token, presence: true, uniqueness: true
  validates :vouchee_email, uniqueness: { scope: :voucher_id, case_sensitive: false }
  normalizes :vouchee_email, with: ->(value) { value.to_s.strip.downcase }
  validate :voucher_is_verified, on: :create
  validate :voucher_under_cap, on: :create

  before_validation :generate_token, on: :create

  def api_json = attributes.except("token").merge("voucherName" => voucher.name)

  private

  def generate_token
    self.token ||= SecureRandom.urlsafe_base64(24)
  end

  def voucher_is_verified
    errors.add(:voucher, "must be a verified musician to vouch for someone") unless voucher&.profile&.verified?
  end

  def voucher_under_cap
    return unless voucher
    errors.add(:base, "You can have at most #{MAX_ACTIVE_PER_VOUCHER} active vouches") if voucher.vouches.count >= MAX_ACTIVE_PER_VOUCHER
  end
end
