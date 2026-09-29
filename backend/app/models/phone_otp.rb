# A single-use, six-digit WhatsApp sign-in code. Mirrors SignInCode (see its header) but
# keyed by phone instead of email; only an HMAC of the code is stored.
class PhoneOtp < ApplicationRecord
  LIFETIME = 10.minutes
  MAX_ATTEMPTS = 5
  SIGN_UP_ROLES = %w[jobseeker employer].freeze

  validates :phone, presence: true
  validates :pending_role, inclusion: { in: SIGN_UP_ROLES }, allow_nil: true
  normalizes :phone, with: ->(value) { value.to_s.strip }

  scope :usable, -> { where(used_at: nil).where("expires_at > ?", Time.current).where("attempts < ?", MAX_ATTEMPTS) }

  def self.issue!(phone:, pending_name: nil, pending_role: nil, pending_consented_at: nil)
    raw = format("%06d", SecureRandom.random_number(1_000_000))
    record = transaction do
      where(phone:, used_at: nil).update_all(used_at: Time.current, updated_at: Time.current)
      otp = new(id: "phoneotp_#{SecureRandom.uuid}", phone:, pending_name:, pending_role:, pending_consented_at:, expires_at: LIFETIME.from_now)
      otp.code_digest = otp.digest_for(raw)
      otp.save!
      otp
    end
    [record, raw]
  end

  def self.latest_usable_for(phone)
    usable.where(phone: phone.to_s.strip).order(created_at: :desc).first
  end

  def self.hmac_key
    Rails.application.key_generator.generate_key("phone-otp-digest", 32)
  end

  def digest_for(raw)
    OpenSSL::HMAC.hexdigest("SHA256", self.class.hmac_key, "#{id}:#{raw}")
  end

  def matches?(raw)
    candidate = raw.to_s.gsub(/\s+/, "")
    candidate = "" unless candidate.match?(/\A\d{6}\z/)
    ActiveSupport::SecurityUtils.secure_compare(code_digest, digest_for(candidate))
  end

  def sign_up? = pending_role.present?
end
