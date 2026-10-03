# Shared helpers for The Stage (community feed) controllers: visibility rules,
# blocking, and the JSON shape shared between the feed and single-post reads.
module Stage
  class BaseController < ApplicationController
    include ActingAs

    before_action :require_login

    private

    def require_login
      authenticate!
    end

    # Posts that exist and have not been taken down.
    def visible_posts = Post.visible

    # Whether `user` (a real person, or nil for anonymous) may see `post`, accounting for
    # followers-only visibility and mutual blocks. Hidden/deleted posts are never visible here;
    # callers filter those out of the base scope first.
    def post_visible_to?(post, user)
      return true if post.visibility == "public"
      return false unless user
      return true if post.created_by_user_id == user.id
      Follow.for_follower(user.id).for_followable(post.author_type, post.author_id).exists?
    end

    # The posts of `posts` that `user` may see (post_visible_to? for a whole list), reading the
    # viewer's follows once instead of once per followers-only post.
    def visible_to(posts, user)
      posts.select do |post|
        post.visibility == "public" || (user && (post.created_by_user_id == user.id || followed_keys(user).include?("#{post.author_type}:#{post.author_id}")))
      end
    end

    # "type:id" of everyone and every Page `user` follows, read once per request.
    def followed_keys(user)
      return Set.new unless user
      @followed_keys ||= Follow.for_follower(user.id).pluck(:followable_type, :followable_id).to_set { |type, id| "#{type}:#{id}" }
    end

    # Everything Post#api_json reads for a page of posts (and the posts they reshare), batched.
    def preload_for_json(posts)
      shown = posts.flat_map { [_1, _1.reshared_post].compact }
      Post.preload_authors(shown)
      Post.preload_shared_jobs(shown)
      Post.preload_media_urls(shown)
    end

    # The includes a list of posts needs before visible_to and preload_for_json.
    LIST_INCLUDES = [{ shared_portfolio_item: :user, created_by: :profile, reshared_post: { created_by: :profile } }].freeze

    def blocked_pair?(user_id_a, user_id_b)
      return false if user_id_a.blank? || user_id_b.blank? || user_id_a == user_id_b
      UserBlock.between?(User.new(id: user_id_a), User.new(id: user_id_b))
    end

    # Identity keys ("type:id") the signed-in person may act, comment or react as — their own
    # account plus every Page they run — used to resolve "did I applaud this" across identities.
    def viewer_actor_keys
      return @viewer_actor_keys if defined?(@viewer_actor_keys)
      @viewer_actor_keys = current_user ? ActorResolver.identities_for(current_user).map(&:key) : []
    end

    # {postId => true} for every post in `posts` this viewer has applauded, as any identity.
    def applauded_post_ids(posts)
      return Set.new if posts.empty? || viewer_actor_keys.empty?
      pairs = viewer_actor_keys.map { _1.split(":", 2) }
      scope = PostReaction.where(post_id: posts.map(&:id))
      matching = pairs.map { |type, id| scope.where(actor_type: type, actor_id: id) }.reduce { |a, b| a.or(b) }
      Set.new((matching || PostReaction.none).pluck(:post_id))
    end

    def find_post!(id = params[:id])
      post = Post.find(id)
      raise ActiveRecord::RecordNotFound unless post_visible_to?(post, current_user) && post.active?
      post
    end

    # Renders 403 and returns nil unless `actor` may act as either party in a real-person
    # relationship (blocking is always between actual people, never Pages).
    def ensure_not_blocked!(other_user_id)
      return true unless other_user_id && current_user && blocked_pair?(other_user_id, current_user.id)
      render_error("You can't do that with this account.", :forbidden, "BLOCKED")
      false
    end
  end
end
