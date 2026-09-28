module Admin
  class BaseController < ApplicationController
    ORIGIN_REQUIRED_MESSAGE = "The admin API only answers the admin site.".freeze

    # The origin check runs first: a token presented from the wrong site is never looked up.
    before_action :require_admin_origin
    before_action -> { authenticate!("admin") }

    private

    # See AdminOrigin: with ADMIN_ORIGIN set, only that exact Origin may call /api/admin/*.
    def require_admin_origin
      return if AdminOrigin.allows?(request)
      render_error(ORIGIN_REQUIRED_MESSAGE, :forbidden, "ADMIN_ORIGIN_REQUIRED")
    end
  end
end
