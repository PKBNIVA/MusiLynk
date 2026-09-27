# Blocking stops messages in both directions and stops either user opening a new
# conversation with the other. Existing history stays readable to both.
class UserBlocksController < ApplicationController
  include UserRateLimit
  include ScalarParams

  CHANGES_PER_HOUR = 60

  before_action -> { authenticate! }

  def create
    return unless require_scalar_params!(:userId)
    return unless within_user_rate_limit?("block", limit: CHANGES_PER_HOUR, period: 1.hour)

    target = User.find_by(id: params[:userId])
    return render_error("User not found", :not_found) unless target
    return render_error("You cannot block yourself.", :unprocessable_content) if target.id == current_user.id

    begin
      UserBlock.find_or_create_by!(blocker: current_user, blocked: target)
    rescue ActiveRecord::RecordNotUnique
      # A concurrent request created it; the outcome is the same.
    end
    audit!("user.block", target)
    render json: { blocked: true }, status: :created
  end

  def destroy
    return unless within_user_rate_limit?("block", limit: CHANGES_PER_HOUR, period: 1.hour)

    UserBlock.where(blocker: current_user, blocked_id: params[:id]).delete_all
    render json: { blocked: false }
  end
end
