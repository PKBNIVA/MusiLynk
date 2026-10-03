# Admin moderation of the Stage beyond the reports flow: any post can be pinned (to the top of
# the feed, until a given time) or deleted outright, and an event post can be featured.
module Admin
  class StagePostsController < BaseController
    include AdminPagination

    def index
      posts = Post.visible.includes(shared_portfolio_item: :user, created_by: :profile, reshared_post: { created_by: :profile }).order(created_at: :desc)
      posts = posts.where(kind: params[:kind]) if params[:kind].present?
      rows, meta = admin_paginate(posts, default_per: 100)
      shown = rows.to_a.flat_map { [_1, _1.reshared_post].compact }
      Post.preload_authors(shown)
      Post.preload_shared_jobs(shown)
      Post.preload_media_urls(rows.to_a)
      render json: { posts: rows.map(&:api_json) }.merge(meta)
    end

    def pin
      post = Post.find(params[:id])
      until_at = parse_until(params[:until]) || 7.days.from_now
      post.update!(pinned_until: until_at)
      audit!("admin.stage_post.pin", post, pinnedUntil: until_at)
      render json: { post: post.api_json }
    end

    def unpin
      post = Post.find(params[:id])
      post.update!(pinned_until: nil)
      audit!("admin.stage_post.unpin", post)
      render json: { post: post.api_json }
    end

    def feature
      post = Post.find(params[:id])
      return render_error("Only event posts can be featured.", :unprocessable_content) unless post.kind == "event"
      featured = params.key?(:featured) ? ActiveModel::Type::Boolean.new.cast(params[:featured]) : !post.featured
      post.update!(featured: featured)
      audit!("admin.stage_post.feature", post, featured: post.featured)
      render json: { post: post.api_json }
    end

    def destroy
      post = Post.find(params[:id])
      post.update!(status: "deleted")
      audit!("admin.stage_post.delete", post)
      render json: { ok: true }
    end

    private

    def parse_until(value)
      return nil if value.blank?
      Time.zone.parse(value.to_s)
    rescue ArgumentError, TypeError
      nil
    end
  end
end
