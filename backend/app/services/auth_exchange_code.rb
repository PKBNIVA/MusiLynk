# A single-use, 60-second code exchanged for the normal bearer session token (see
# AuthController#exchange). GoogleAuthController#callback is a full-page browser
# redirect — it cannot set an Authorization header — so it never puts the session
# token itself in a URL, where it would leak via browser history, a Referer header or
# a hosting provider's request logs; only this opaque, one-time code, which the SPA
# exchanges over a normal fetch and which is unusable a second time or once expired.
#
# Backed by Rails.cache (Solid Cache in production) rather than a table: the code is
# meaningless once redeemed or after 60 seconds, so nothing here needs to persist.
class AuthExchangeCode
  TTL = 60.seconds
  PREFIX = "auth_exchange_code".freeze

  def self.issue!(user)
    code = SecureRandom.urlsafe_base64(32)
    Rails.cache.write(key(code), user.id, expires_in: TTL)
    code
  end

  # Returns the User the code was issued for, consuming it — or nil when the code was
  # never issued, was already redeemed, or has expired.
  def self.redeem!(code)
    return nil if code.blank?
    user_id = Rails.cache.read(key(code))
    return nil unless user_id
    Rails.cache.delete(key(code))
    User.find_by(id: user_id)
  end

  def self.key(code) = "#{PREFIX}:#{code}"
end
