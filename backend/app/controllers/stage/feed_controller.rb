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
        .includes(:created_by, :shared_portfolio_item, :shared_job, reshared_post: :created_by)
        .order(created_at: :desc, id: :desc).limit(POOL_LIMIT).to_a

      user = current_user
      candidates.select! { post_visible_to?(_1, user) && !blocked_pair?(_1.created_by_user_id, user&.id) }

      followed_keys = user ? Set.new(Follow.for_follower(user.id).pluck(:followable_type, :followable_id).map { |t, i| "#{t}:#{i}" }) : Set.new
      own_keys = viewer_actor_keys.to_set
      city = user&.profile&.location.presence
      genres = Set.new(Array(user&.profile&.genres).map { _1.to_s.downcase })

      scored = candidates.map { |post| [score(post, followed_keys, own_keys, city, genres), post] }
      scored.sort_by! { |score, post| [-score, -post.created_at.to_f, post.id] }

      after = decode_cursor(params[:cursor])
      start_index = after ? (scored.index { |score, post| [score, post.created_at.to_f, post.id] == after }&.+(1) || 0) : 0
      page = scored[start_index, PAGE_SIZE] || []

      applauded = applauded_post_ids(page.map(&:last))
      next_cursor = page.length == PAGE_SIZE && scored[start_index + PAGE_SIZE] ? encode_cursor(page.last) : nil

      render json: { posts: page.map { |_score, post| post.api_json(applauded_post_ids: applauded) }, nextCursor: next_cursor }
    end

    private

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

    def encode_cursor(entry)
      score, post = entry
      Base64.urlsafe_encode64({ s: score, t: post.created_at.to_f, i: post.id }.to_json)
    end

    def decode_cursor(raw)
      return nil if raw.blank?
      data = JSON.parse(Base64.urlsafe_decode64(raw))
      [data["s"].to_f, data["t"].to_f, data["i"]]
    rescue ArgumentError, JSON::ParserError, TypeError
      nil
    end
  end
end
