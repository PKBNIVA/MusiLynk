# Server-side password rule shared by registration, password reset and the account
# settings password change: length >= MIN_LENGTH, not one of the 1,000 most common
# passwords (backend/config/common_passwords.txt, checked case-insensitively), and
# not built from the account's own email local part or name (so "maria2024" is
# rejected for maria@example.com just as "maria" is).
class PasswordStrength
  MIN_LENGTH = 10
  COMMON_PASSWORDS_PATH = Rails.root.join("config", "common_passwords.txt")
  # Fragments (not full sentences): each reads naturally after "Password ", which is how
  # both ActiveModel's full_message ("Password " + attribute error) and the account
  # controllers ("Password " + violation, in their own error responses) use them.
  TOO_SHORT = "must be at least #{MIN_LENGTH} characters.".freeze
  TOO_COMMON = "is too common. Choose something more unusual.".freeze
  CONTAINS_IDENTITY = "may not contain your name or email address.".freeze

  def self.common_passwords
    @common_passwords ||= COMMON_PASSWORDS_PATH.readlines.map { _1.strip.downcase }.reject(&:blank?).to_set
  end

  # Returns nil when the password is acceptable, or an error message otherwise.
  # email/name are optional context (the account's own address and display name).
  def self.violation(password, email: nil, name: nil)
    value = password.to_s
    return TOO_SHORT if value.length < MIN_LENGTH
    return TOO_COMMON if common_passwords.include?(value.downcase)

    downcased = value.downcase
    identity_fragments(email:, name:).each do |fragment|
      return CONTAINS_IDENTITY if fragment.present? && fragment.length >= 3 && downcased.include?(fragment)
    end
    nil
  end

  def self.valid?(password, email: nil, name: nil) = violation(password, email:, name:).nil?

  def self.identity_fragments(email:, name:)
    local_part = email.to_s.split("@").first.to_s.downcase
    name_parts = name.to_s.downcase.split(/[^a-z0-9]+/)
    [local_part, *name_parts]
  end
end
