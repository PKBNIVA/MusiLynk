# The "Upcoming in <city>" strip (next 3 events) and each event's ICS download.
module Stage
  class EventsController < BaseController
    skip_before_action :require_login, only: %i[ics]
    STRIP_LIMIT = 3

    def index
      city = params[:city].presence || current_user&.profile&.location
      events = Post.upcoming_events(city:).limit(STRIP_LIMIT)
      render json: { city:, events: events.map(&:api_json) }
    end

    def ics
      post = Post.find(params[:id])
      return render_error("Not an event.", :not_found) unless post.kind == "event" && post.active? && post.visibility == "public"
      send_data post.to_ics, type: "text/calendar", filename: "#{post.event_title.to_s.parameterize.presence || 'event'}.ics", disposition: "attachment"
    end
  end
end
