module Stage
  class PostsController < BaseController
    include UserRateLimit

    skip_before_action :require_login, only: %i[show by_author]
    CREATE_LIMIT_PER_HOUR = RateLimits.limit("stage.posts")

    def show
      post = find_post!
      render json: { post: post.api_json(applauded_post_ids: applauded_post_ids([post])) }
    end

    def by_author
      type = params[:type].to_s
      return render_error("Unknown author type.", :unprocessable_content, "INVALID_AUTHOR_TYPE") unless Post::AUTHOR_TYPES.include?(type)

      candidates = Post.visible.by_author(type, Post.canonical_author_id(type, params[:authorId] || params[:id]))
        .includes(*LIST_INCLUDES).order(created_at: :desc, id: :desc).limit(500).to_a
      page, next_cursor = paginate(visible_to(candidates, current_user))
      preload_for_json(page)
      applauded = applauded_post_ids(page)
      json = { posts: page.map { _1.api_json(applauded_post_ids: applauded) }, nextCursor: next_cursor }.to_json
      return if public_cache!(:stage_posts, etag: json)
      render json: json
    end

    def create
      return unless within_user_rate_limit?("stage.posts")
      return unless check_event_permission
      actor = current_actor
      return unless actor
      return unless check_related_blocks

      post = Post.new(post_params)
      post.author_type = actor.type
      post.author_id = actor.id
      post.created_by_user_id = current_user.id
      post.status = "active"
      post.save!
      bump_reshare_count(post)
      Notifier.stage_reshare(post.reshared_post, post, actor) if post.reshared_post && !blocked_pair?(post.reshared_post.created_by_user_id, current_user.id)
      flags = ScamSignals.detect(post.body, from_hiring_side: true, early: true)
      audit!("stage.post.create", post, flags.present? ? { safetyFlags: flags } : {})
      render json: { id: post.id, post: post.api_json }, status: :created
    end

    def update
      post = Post.find(params[:id])
      return unless authorize_owner!(post)

      post.update!(update_params)
      render json: { post: post.api_json }
    end

    def destroy
      post = Post.find(params[:id])
      return unless authorize_owner!(post)

      post.update!(status: "deleted")
      audit!("stage.post.delete", post)
      render json: { ok: true }
    end

    private

    # Meetup/event posts are creatable by verified users and admins only (not part of the
    # ordinary "anyone can post" Stage flow).
    def check_event_permission
      return true unless params[:kind].to_s == "event"
      return true if current_user.admin? || current_user.profile&.verified?
      render_error("Only verified musicians and admins can post events.", :forbidden, "NOT_VERIFIED")
      false
    end

    def authorize_owner!(post)
      actor = current_actor
      return false unless actor
      return true if post.editable_by?(actor)

      render_error("You can only manage your own posts.", :forbidden, "NOT_OWNER")
      false
    end

    # Blocks apply between real people; a reshare of someone else's post checks the block
    # between the resharer and the original author before the post is even built.
    def check_related_blocks
      reshared = params[:resharedPostId].presence && Post.find_by(id: params[:resharedPostId])
      return true unless reshared
      ensure_not_blocked!(reshared.created_by_user_id)
    end

    def bump_reshare_count(post)
      return unless post.reshared_post_id
      Post.where(id: post.reshared_post_id).update_all("reshare_count = reshare_count + 1")
    end

    def post_params
      permitted = params.permit(:kind, :body, :linkUrl, :city, :visibility, :sharedPortfolioItemId, :sharedJobId, :resharedPostId,
        :eventTitle, :eventStartsAt, :eventVenue,
        genres: [], media: [:uploadId, :type, :caption])
      {
        kind: permitted[:kind] || "update",
        body: permitted[:body],
        link_url: permitted[:linkUrl],
        city: permitted[:city],
        visibility: permitted[:visibility] || "public",
        genres: Array(permitted[:genres]),
        media: Array(permitted[:media]).map(&:to_h),
        event_title: permitted[:eventTitle],
        event_starts_at: permitted[:eventStartsAt],
        event_venue: permitted[:eventVenue],
        shared_portfolio_item_id: permitted[:sharedPortfolioItemId],
        shared_job_id: permitted[:sharedJobId],
        reshared_post_id: permitted[:resharedPostId]
      }.compact
    end

    # Only what the request names: an edit that leaves out visibility or genres must not reset them.
    def update_params
      permitted = params.permit(:body, :linkUrl, :city, :visibility, genres: [])
      changes = {}
      changes[:body] = permitted[:body] if permitted.key?(:body)
      changes[:link_url] = permitted[:linkUrl] if permitted.key?(:linkUrl)
      changes[:city] = permitted[:city] if permitted.key?(:city)
      changes[:visibility] = permitted[:visibility] if permitted.key?(:visibility)
      changes[:genres] = Array(permitted[:genres]) if params.key?(:genres)
      changes
    end

    def paginate(sorted)
      after = params[:cursor].present? ? decode_offset(params[:cursor]) : 0
      page = sorted[after, 20] || []
      next_cursor = sorted.length > after + page.length ? Base64.urlsafe_encode64((after + page.length).to_s) : nil
      [page, next_cursor]
    end

    def decode_offset(cursor)
      Integer(Base64.urlsafe_decode64(cursor))
    rescue ArgumentError, TypeError
      0
    end
  end
end
