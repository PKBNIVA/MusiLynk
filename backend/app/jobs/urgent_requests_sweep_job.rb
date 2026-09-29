# "Requests never go silent": runs every 30 minutes (see config/initializers/good_job.rb).
#
# (a) 6 hours before an open request with at least one response expires, nudges the hirer
#     once (expiry_warned_at marks it done) with one-click "mark filled"/"close" links.
# (b) once a request's expires_at has passed while it is still open, marks it expired and
#     tells every musician who responded that the hirer never confirmed a booking.
class UrgentRequestsSweepJob < ApplicationJob
  queue_as :default

  def perform
    warn_before_expiry
    expire_lapsed
  end

  private

  def warn_before_expiry
    UrgentRequest.due_for_expiry_warning.find_each do |request|
      filled_link = UrgentActionToken.link(request, "filled", frontend_url:)
      close_link = UrgentActionToken.link(request, "close", frontend_url:)
      Notifier.urgent_request_expiry_warning(request, filled_link:, close_link:)
      request.update!(expiry_warned_at: Time.current)
    end
  end

  def expire_lapsed
    UrgentRequest.due_to_expire.find_each do |request|
      request.update!(status: "expired")
      responder_ids = request.urgent_request_responses.pluck(:user_id)
      User.where(id: responder_ids).find_each { |user| Notifier.urgent_request_expired(request, user) }
    end
  end

  def frontend_url = NotificationEmail.frontend_url
end
