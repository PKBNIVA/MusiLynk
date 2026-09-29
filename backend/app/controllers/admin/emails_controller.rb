module Admin
  class EmailsController < BaseController
    ALLOWED_WINDOWS = [7, 30].freeze

    def show
      days = params[:days].to_i
      days = 7 unless ALLOWED_WINDOWS.include?(days)
      render json: LifecycleEmailQueries.summary(days:)
    end
  end
end
