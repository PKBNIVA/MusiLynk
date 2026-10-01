module Stage
  class PostCommentsController < BaseController
    include UserRateLimit

    skip_before_action :require_login, only: :index
    LIMIT_PER_HOUR = 60

    def index
      post = find_post!(params[:post_id])
      comments = post.post_comments.visible.includes(:created_by).order(created_at: :asc)
      render json: { comments: comments.map(&:api_json) }
    end

    def create
      return unless within_user_rate_limit?("stage.comments", limit: LIMIT_PER_HOUR, period: 1.hour)
      post = find_post!(params[:post_id])
      actor = current_actor
      return unless actor
      return unless ensure_not_blocked!(post.created_by_user_id)

      parent = post.post_comments.find_by(id: params[:parentId]) if params[:parentId].present?
      comment = post.post_comments.create!(
        author_type: actor.type, author_id: actor.id, created_by_user_id: current_user.id,
        body: params[:body], parent_id: parent&.id, status: "active"
      )
      Post.where(id: post.id).update_all("comment_count = comment_count + 1")
      Notifier.stage_comment(post, comment, actor) if post.created_by_user_id != current_user.id
      Notifier.stage_reply(post, parent, comment, actor) if parent&.active? && !blocked_pair?(parent.created_by_user_id, current_user.id)
      flags = ScamSignals.detect(comment.body, from_hiring_side: true, early: true)
      audit!("stage.comment.create", comment, flags.present? ? { safetyFlags: flags } : {})
      render json: { id: comment.id, comment: comment.api_json }, status: :created
    end

    def destroy
      comment = PostComment.find(params[:id])
      post = comment.post
      actor = current_actor
      return unless actor
      unless comment.editable_by?(actor) || post.editable_by?(actor)
        return render_error("You can only delete your own comments, or comments on your own post.", :forbidden, "NOT_OWNER")
      end

      comment.update!(status: "deleted")
      Post.where(id: post.id).where("comment_count > 0").update_all("comment_count = comment_count - 1")
      audit!("stage.comment.delete", comment)
      render json: { ok: true }
    end
  end
end
