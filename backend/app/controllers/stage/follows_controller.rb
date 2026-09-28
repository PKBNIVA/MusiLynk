module Stage
  class FollowsController < BaseController
    skip_before_action :require_login, only: %i[followers following]

    def create
      type, id = target_identity(params[:followableType], params[:followableId])
      return render_error("Unknown identity to follow.", :unprocessable_content, "INVALID_FOLLOWABLE") unless type

      followable_user_id = type == "user" ? id : nil
      return unless followable_user_id.nil? || ensure_not_blocked!(followable_user_id)

      follow = Follow.find_or_initialize_by(follower_user_id: current_user.id, followable_type: type, followable_id: id)
      created = follow.new_record?
      follow.save!
      Notifier.stage_new_follower(follow, current_user) if created
      render json: { ok: true, following: true }, status: :created
    end

    def destroy
      type, id = target_identity(params[:type], params[:id])
      return render_error("Unknown identity.", :unprocessable_content, "INVALID_FOLLOWABLE") unless type

      Follow.for_follower(current_user.id).for_followable(type, id).destroy_all
      render json: { ok: true, following: false }
    end

    def followers
      type = params[:type].to_s
      return render_error("Unknown identity type.", :unprocessable_content, "INVALID_AUTHOR_TYPE") unless Post::AUTHOR_TYPES.include?(type)

      count = Follow.for_followable(type, params[:id]).count
      following = current_user && Follow.for_follower(current_user.id).for_followable(type, params[:id]).exists?
      render json: { followersCount: count, following: !!following }
    end

    def following
      return render_error("Only a person's own following list is available.", :unprocessable_content, "INVALID_AUTHOR_TYPE") unless params[:type] == "user"

      render json: { followingCount: Follow.for_follower(params[:id]).count }
    end

    private

    def target_identity(type, id)
      return nil unless Post::AUTHOR_TYPES.include?(type.to_s) && id.present?
      [type.to_s, id.to_s]
    end
  end
end
