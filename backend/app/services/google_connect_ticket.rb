# A single-use, 5-minute ticket that lets GoogleAuthController#start/#callback identify
# the signed-in user linking a Google account (intent=connect), without ever putting
# their bearer session token in the OAuth start URL — a full-page navigation the
# browser sends, not the SPA, so it cannot carry an Authorization header, and a token
# in that URL would leak the same way a session-token exchange code would (see
# AuthExchangeCode). The SPA fetches a ticket (POST /api/auth/connect-ticket, signed
# in) before navigating to /auth/google/start?intent=connect&ticket=….
#
# Backed by Rails.cache, like AuthExchangeCode.
class GoogleConnectTicket
  TTL = 5.minutes
  PREFIX = "google_connect_ticket".freeze

  def self.issue!(user)
    ticket = SecureRandom.urlsafe_base64(32)
    Rails.cache.write(key(ticket), user.id, expires_in: TTL)
    ticket
  end

  # True while the ticket is still valid — checked without consuming it.
  def self.valid?(ticket)
    ticket.present? && Rails.cache.exist?(key(ticket))
  end

  # Returns the User the ticket was issued for, consuming it — or nil when the ticket
  # was never issued, was already redeemed, or has expired.
  def self.redeem!(ticket)
    return nil if ticket.blank?
    user_id = Rails.cache.read(key(ticket))
    return nil unless user_id
    Rails.cache.delete(key(ticket))
    User.find_by(id: user_id)
  end

  def self.key(ticket) = "#{PREFIX}:#{ticket}"
end
