module Stage
  # The Stage home feed: posts from people and Pages you follow (plus your own), posts matching your
  # city and genres, and trending posts (applause + comments in the last 72h, time-decayed).
  #
  # Paging is keyset on (created_at, id), newest first (R4): each page is the next PAGE_SIZE visible
  # posts older than the cursor, ranked within that window by the blend above, so every post is
  # reachable and a post published mid-scroll never shifts a later page (no duplicates, no skips).
  # Pinned posts lead the first page and are left out of the stream while pinned.
  class FeedController < BaseController
    PAGE_SIZE = 20
    # Posts read per statement while filling a page; at most MAX_BATCHES statements per page, so a
    # long run of posts the viewer cannot see ends the page early instead of scanning on.
    BATCH_SIZE = 60
    MAX_BATCHES = 3
    PINNED_LIMIT = 3
    # Above everything else: a pinned post (admin, or the weekly system roundup) always leads
    # the feed while it's pinned.
    PINNED_BONUS = 1_000_000_000.0
    FOLLOWED_BONUS = 1_000_000.0
    LOCATION_BONUS = 500_000.0
    TRENDING_WEIGHT = 1_000.0

    def index
      user = current_user
      cursor = decode_cursor(params[:cursor])
      # Follows and blocks are read once for the whole page (one query each), not once per post.
      blocked = blocked_user_ids(user)
      shown = ->(posts) { visible_to(posts, user).reject { blocked.include?(_1.created_by_user_id) } }
      listed = visible_posts.where.not(status: %w[hidden deleted]).includes(*LIST_INCLUDES)

      pinned = cursor ? [] : shown.(listed.pinned.order(pinned_until: :desc, id: :desc).limit(PINNED_LIMIT).to_a)
      stream = listed.where("posts.pinned_until IS NULL OR posts.pinned_until <= ?", Time.current).order(created_at: :desc, id: :desc)
      page, last_read, exhausted = fill_page(stream, cursor, shown)

      followed_keys = followed_keys(user)
      own_keys = viewer_actor_keys.to_set
      city = user&.profile&.location.presence
      genres = Set.new(Array(user&.profile&.genres).map { _1.to_s.downcase })
      ranked = page.map { |post| [score(post, followed_keys, own_keys, city, genres), post] }
      ranked.sort_by! { |score, post| [-score, -post.created_at.to_f, post.id] }
      posts = pinned + ranked.map(&:last)

      preload_for_json(posts)
      applauded = applauded_post_ids(posts)
      next_cursor = !exhausted && last_read ? encode_cursor(last_read) : nil
      render json: { posts: posts.map { _1.api_json(applauded_post_ids: applauded) }, nextCursor: next_cursor }
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

    # Reads `stream` after `cursor` in batches until PAGE_SIZE posts pass `shown`. Returns the page,
    # the last post read (the next cursor: posts read but not shown are not read again), and whether
    # the stream ran out.
    def fill_page(stream, cursor, shown)
      page = []
      last_read = nil
      boundary = cursor
      MAX_BATCHES.times do
        scope = boundary ? stream.where("(posts.created_at, posts.id) < (?, ?)", boundary[:created_at], boundary[:id]) : stream
        batch = scope.limit(BATCH_SIZE).to_a
        visible = shown.(batch).to_set
        batch.each do |post|
          last_read = post
          next unless visible.include?(post)
          page << post
          return [page, last_read, batch.length < BATCH_SIZE && post.equal?(batch.last)] if page.length == PAGE_SIZE
        end
        return [page, last_read, true] if batch.length < BATCH_SIZE
        boundary = { created_at: last_read.created_at, id: last_read.id }
      end
      [page, last_read, false]
    end

    # The cursor is the (created_at, id) of the last post read, opaque to clients.
    def encode_cursor(post) = Base64.urlsafe_encode64({ t: post.created_at.utc.iso8601(6), i: post.id }.to_json)

    # { created_at:, id: } or nil (first page). The pre-R4 cursor ({ i: id, o: offset }) is still
    # read for one release: it continues after that post's (created_at, id).
    def decode_cursor(raw)
      return nil if raw.blank? || !raw.is_a?(String)
      data = JSON.parse(Base64.urlsafe_decode64(raw))
      return nil unless data.is_a?(Hash) && data["i"].is_a?(String)
      if data.key?("t")
        created_at = Time.iso8601(data["t"].to_s)
        return { created_at:, id: data["i"] }
      end
      deprecated_offset_cursor!
      created_at = Post.where(id: data["i"]).pick(:created_at)
      created_at ? { created_at:, id: data["i"] } : nil
    rescue ArgumentError, JSON::ParserError, TypeError
      nil
    end

    def deprecated_offset_cursor!
      Rails.logger.info({ event: "deprecated_offset_cursor", list: "stage_feed" }.to_json)
    end
  end
end
