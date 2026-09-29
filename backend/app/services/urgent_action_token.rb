# One-click "mark filled" / "close" links sent in the expiry-warning email
# (see UrgentRequestsSweepJob, Notifier#urgent_request_expiry_warning). The token is signed
# and scoped to one request + one action, and expires after 7 days — long enough to outlive
# the 6-hour warning window comfortably, short enough that an old email stops working.
class UrgentActionToken
  PURPOSE = :urgent_request_action
  EXPIRES_IN = 7.days
  ACTIONS = %w[filled close].freeze

  def self.generate(urgent_request, action)
    raise ArgumentError, "unknown action" unless ACTIONS.include?(action.to_s)
    verifier.generate({ "id" => urgent_request.id, "action" => action.to_s }, purpose: PURPOSE, expires_in: EXPIRES_IN)
  end

  def self.link(urgent_request, action, frontend_url:)
    "#{frontend_url}/urgent/#{urgent_request.id}?action=#{action}&t=#{CGI.escape(generate(urgent_request, action))}"
  end

  # Returns { "id" =>, "action" => } or nil if the token is missing, expired or tampered with.
  def self.verify(token)
    verifier.verified(token.to_s, purpose: PURPOSE)
  rescue StandardError
    nil
  end

  def self.verifier = Rails.application.message_verifier("urgent-request-action")
end
