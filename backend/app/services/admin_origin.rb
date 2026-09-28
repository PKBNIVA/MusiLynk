# The admin site's origin (ADMIN_ORIGIN, e.g. https://verse-admin-xxxx.vercel.app).
#
# When it is set, the admin API (/api/admin/*) and admin sign-in only answer browsers on that
# exact origin: the Origin header must match character for character, and a request without
# one is refused too, so a script or a page on any other site cannot drive the admin API
# with a stolen or leaked token. Unset (local, tests, and production before the admin site
# exists) nothing changes anywhere.
class AdminOrigin
  def self.configured
    ENV["ADMIN_ORIGIN"].to_s.strip.sub(%r{/+\z}, "").presence
  end

  def self.locked? = configured.present?

  # True when the request comes from the admin site. Never true while ADMIN_ORIGIN is unset.
  def self.matches?(request)
    expected = configured
    origin = request.origin.to_s
    expected.present? && origin.present? && ActiveSupport::SecurityUtils.secure_compare(origin, expected)
  end

  # True when the request may reach an admin-only endpoint: the lock is off, or it matches.
  def self.allows?(request) = !locked? || matches?(request)
end
