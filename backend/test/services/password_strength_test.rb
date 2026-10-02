require "test_helper"

class PasswordStrengthTest < ActiveSupport::TestCase
  test "short, common and identity-based passwords are refused" do
    assert_equal PasswordStrength::TOO_SHORT, PasswordStrength.violation("Ab1!")
    assert_equal PasswordStrength::TOO_COMMON, PasswordStrength.violation(PasswordStrength.common_passwords.find { _1.length >= PasswordStrength::MIN_LENGTH })
    assert_equal PasswordStrength::CONTAINS_IDENTITY, PasswordStrength.violation("MariaSings2024!", email: "maria@example.com")
    assert_equal PasswordStrength::CONTAINS_IDENTITY, PasswordStrength.violation("xSharma#Studio9", name: "Aditya Sharma")
  end

  test "short name parts do not block unrelated passwords" do
    assert PasswordStrength.valid?("Valiant-Harbor-72", name: "Ali Khan", email: "al@example.com")
  end

  test "users validate the password a person chooses, but seeds can set operator passwords" do
    user = User.new(name: "MusiLynk Admin", email: "admin@example.com", role: "admin", status: "active", password: "Admin@12345")
    assert_not user.valid?
    assert_includes user.errors[:password], PasswordStrength::CONTAINS_IDENTITY

    user.skip_password_strength = true
    assert user.valid?, user.errors.full_messages.to_sentence
  end
end
