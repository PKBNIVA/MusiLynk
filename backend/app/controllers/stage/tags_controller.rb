module Stage
  # Hashtag search: GET /api/stage/tags/:tag.
  class TagsController < BaseController
    skip_before_action :require_login

    def show
      tag = params[:tag].to_s.downcase.delete_prefix("#")
      # `@>` (array contains) is what the hashtags GIN index serves; `? = ANY(hashtags)` read every post.
      candidates = Post.visible.where("posts.hashtags @> ARRAY[?]::varchar[]", tag)
        .includes(*LIST_INCLUDES).order(created_at: :desc, id: :desc).limit(500).to_a
      page, next_cursor = paginate(visible_to(candidates, current_user))
      preload_for_json(page)
      applauded = applauded_post_ids(page)
      render json: { tag:, posts: page.map { _1.api_json(applauded_post_ids: applauded) }, nextCursor: next_cursor }
    end

    private

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
