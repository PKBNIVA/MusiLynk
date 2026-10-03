module ApplicationCable
  # A socket is opened with ?ticket= from POST /api/cable/ticket (RealtimeTicket): a short-lived
  # signed session id, since browsers cannot send the bearer token on a WebSocket. The session is
  # checked again here, so a signed-out or expired session cannot connect with an old ticket.
  class Connection < ActionCable::Connection::Base
    identified_by :current_user

    def connect
      self.current_user = RealtimeTicket.user_for(request.params[:ticket]) || reject_unauthorized_connection
    end
  end
end
