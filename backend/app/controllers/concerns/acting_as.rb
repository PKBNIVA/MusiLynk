# Resolves the "acting as" identity for a request. Clients send it as the X-Verse-Act-As header
# ("organization:org_123", "act:act_123" or "user:<id>"); without it the person acts as themselves.
module ActingAs
  extend ActiveSupport::Concern

  HEADER = "X-Verse-Act-As".freeze

  private

  # Call from actions that can be done as a Page. Renders 403 and returns nil when the requested
  # identity is not one the signed-in person manages.
  def current_actor
    return @current_actor if defined?(@current_actor)

    key = request.headers[HEADER].presence || params[:actingAs].presence
    @current_actor = ActorResolver.resolve(current_user, key)
    render_error("You can't act as that page.", :forbidden, "ACT_AS_FORBIDDEN") unless @current_actor
    @current_actor
  end
end
