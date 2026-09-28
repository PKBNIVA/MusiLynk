module Stage
  # "Applause" reactions on a post (POST to add, DELETE to remove), acting-as aware.
  class ApplauseController < BaseController
    include UserRateLimit

    LIMIT_PER_HOUR = 300

    def create
      return unless within_user_rate_limit?("stage.applause", limit: LIMIT_PER_HOUR, period: 1.hour)
      post = find_post!
      actor = current_actor
      return unless actor
      return unless ensure_not_blocked!(post.created_by_user_id)

      reaction = PostReaction.find_or_initialize_by(post_id: post.id, actor_type: actor.type, actor_id: actor.id, kind: "applause")
      newly_created = reaction.new_record?
      reaction.save!
      if newly_created
        Post.where(id: post.id).update_all("applause_count = applause_count + 1")
        Notifier.stage_applause(post, actor) if post.created_by_user_id != current_user.id
      end
      render json: { ok: true, applauseCount: post.reload.applause_count }, status: :created
    end

    def destroy
      post = find_post!
      actor = current_actor
      return unless actor

      reaction = PostReaction.find_by(post_id: post.id, actor_type: actor.type, actor_id: actor.id, kind: "applause")
      if reaction
        reaction.destroy!
        Post.where(id: post.id).where("applause_count > 0").update_all("applause_count = applause_count - 1")
      end
      render json: { ok: true, applauseCount: post.reload.applause_count }
    end
  end
end
