# Shared fixtures for the promo / referral code tests.
require "minitest/mock"
module PromoCodeHelpers
  def create_person(name = "Code Buyer", role = "employer")
    user = User.create!(name:, email: "#{role}-#{SecureRandom.hex(5)}@example.com", password: "StrongPass123!", role:, status: "active")
    user.create_profile!
    token = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(token), expires_at: 1.year.from_now)
    [user, token]
  end

  def bearer(token) = { "Authorization" => "Bearer #{token}" }

  def make_code(kind: "discount_percent", code: "CODE#{SecureRandom.hex(3)}", **attributes)
    defaults = case kind
    when "discount_percent" then { percent_off: 20, duration_periods: 2 }
    when "extended_trial" then { trial_days: 90 }
    else {}
    end
    PromoCode.create!({ code:, kind: }.merge(defaults).merge(attributes))
  end

  def with_env(values)
    previous = values.to_h { |key, _| [key, ENV[key]] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
