# Short-lived signed tickets that let a browser open the Action Cable socket (see
# ApplicationCable::Connection). A ticket names a session, not a user, so signing out or an expired
# session also invalidates tickets already handed out.
module RealtimeTicket
  PURPOSE = :cable

  module_function

  def ttl = Integer(settings.fetch("ticket_ttl_seconds")).seconds
  def tickets_per_minute = Integer(settings.fetch("tickets_per_minute"))

  def issue(session) = verifier.generate(session.id, expires_in: ttl, purpose: PURPOSE)

  # The user of an active session the ticket names, or nil.
  def user_for(ticket)
    return nil if ticket.blank? || !ticket.is_a?(String)
    session_id = verifier.verified(ticket, purpose: PURPOSE)
    return nil unless session_id
    session = Session.active.find_by(id: session_id)
    session.user if session && session.expires_at > Time.current && session.user&.active?
  end

  def verifier = Rails.application.message_verifier("realtime-ticket")

  def settings
    @settings ||= YAML.safe_load_file(Rails.root.join("config/realtime.yml")).freeze
  end
end
