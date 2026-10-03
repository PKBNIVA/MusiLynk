module Stage
  # The Stage home feed: a blend of posts from people and Pages you follow (plus your own),
  # posts matching your city and genres, and trending posts (applause + comments in the last
  # 72h, time-decayed). Cursor-paginated over the ranked order.
  class FeedController < BaseController
    PAGE_SIZE = 20
    POOL_LIMIT = 500
    # Above everything else: a pinned post (admin, or the weekly system roundup) always leads
    # the feed while it's pinned.
    PINNED_BONUS = 1_000_000_000.0
    FOLLOWED_BONUS = 1_000_000.0
    LOCATION_BONUS = 500_000.0
    TRENDING_WEIGHT = 1_000.0

    def index
      candidates = visible_posts.where.not(status: %w[hidden deleted])
        .includes(*LIST_INCLUDES).order(created_at: :desc, id: :desc).limit(POOL_LIMIT).to_a

      user = current_user
      # Follows and blocks are read once for the whole pool (one query each), not once per post:
      # the per-post checks cost a query or two for each of up to POOL_LIMIT candidates (549 a request).
      blocked = blocked_user_ids(user)
      candidates = visible_to(candidates, user).reject { blocked.include?(_1.created_by_user_id) }
      followed_keys = followed_keys(user)
      own_keys = viewer_actor_keys.to_set
      city = user&.profile&.location.presence
      genres = Set.new(Array(user&.profile&.genres).map { _1.to_s.downcase })

      scored = candidates.map { |post| [score(post, followed_keys, own_keys, city, genres), post] }
      scored.sort_by! { |score, post| [-score, -post.created_at.to_f, post.id] }

      start_index = start_index_for(scored, decode_cursor(params[:cursor]))
      page = scored[start_index, PAGE_SIZE] || []

      preload_for_json(page.map(&:last))
      applauded = applauded_post_ids(page.map(&:last))
      next_cursor = page.length == PAGE_SIZE && scored[start_index + PAGE_SIZE] ? encode_cursor(page.last, start_index + page.length) : nil

      render json: { posts: page.map { |_score, post| post.api_json(applauded_post_ids: applauded) }, nextCursor: next_cursor }
    end

    private

    # Everyone the viewer blocked or was blocked by (either direction hides their posts).
    def blocked_user_ids(user)
      return Set.new unless user
      UserBlock.where(blocker_id: user.id).or(UserBlock.where(blocked_id: user.id)).pluck(:blocker_id, :blocked_id).flatten.to_set.delete(user.id)
    end

    def score(post, followed_keys, own_keys, city, genres)
      key = "#{post.author_type}:#{post.author_id}"
      total = 0.0
      total += PINNED_BONUS if post.pinned?
      total += FOLLOWED_BONUS if own_keys.include?(key) || followed_keys.include?(key)
      matches_location = city.present? && post.city.present? && post.city.casecmp?(city)
      matches_genre = genres.any? && Array(post.genres).any? { genres.include?(_1.to_s.downcase) }
      total += LOCATION_BONUS if matches_location || matches_genre
      hours = [(Time.current - post.created_at) / 3600.0, 0].max
      if hours <= Post::TRENDING_WINDOW / 1.hour
        engagement = post.applause_count + (post.comment_count * 2)
        total += engagement * (2.0**(-hours / 24.0)) * TRENDING_WEIGHT
      end
      total
    end

    # The ranking is time-decayed, so a score recorded on one request never equals the score of
    # the same post on the next. The cursor therefore remembers the last post's id (continue right
    # after it wherever it now ranks) and the offset it was served at (used when that post has
    # dropped out of the candidate pool), never the score itself.
    def encode_cursor(entry, offset)
      _score, post = entry
      Base64.urlsafe_encode64({ i: post.id, o: offset }.to_json)
    end

    def decode_cursor(raw)
      return nil if raw.blank?
      data = JSON.parse(Base64.urlsafe_decode64(raw))
      return nil unless data.is_a?(Hash)
      { id: data["i"].to_s, offset: data["o"].to_i }
    rescue ArgumentError, JSON::ParserError, TypeError
      nil
    end

    def start_index_for(scored, cursor)
      return 0 unless cursor
      found = scored.index { |_score, post| post.id == cursor[:id] }
      found ? found + 1 : [[cursor[:offset], 0].max, scored.length].min
    end
  end
end
