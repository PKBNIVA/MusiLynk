module Stage
  # GET /api/stage/authors/:type/:id — who a Stage author page is about, independent of whether
  # they have posted anything. Unknown, removed or hidden identities are a 404 so the page can
  # say "not found" instead of waiting for a post that will never exist.
  class AuthorsController < BaseController
    skip_before_action :require_login

    def show
      type = params[:type].to_s
      return render_error("Unknown author type.", :unprocessable_content, "INVALID_AUTHOR_TYPE") unless Post::AUTHOR_TYPES.include?(type)

      author = author_json(type, Post.canonical_author_id(type, params[:id].to_s).to_s)
      return render_error("This author could not be found.", :not_found, "NOT_FOUND") unless author
      render json: { author: }
    end

    private

    def author_json(type, id)
      case type
      when "system"
        { type:, id:, name: Post::SYSTEM_AUTHOR_NAME, avatar: Post::SYSTEM_AVATAR, verified: false, system: true } if id == Post::SYSTEM_AUTHOR_ID
      when "organization"
        org = Organization.find_by(id:, status: "active")
        { type:, id: org.id, name: org.name, avatar: nil, verified: false, system: false } if org
      when "act"
        act = Act.where.not(status: "hidden").find_by(id:)
        { type:, id: act.id, name: act.name, avatar: act.photo_url.presence, verified: false, system: false } if act
      else
        user = User.find_by(id:)
        return unless user&.active? && SyntheticQa::Demo.publicly_listed(User.where(id: user.id)).exists?
        profile = user.profile
        { type:, id: user.id, name: user.name, avatar: profile&.photo_url.presence, verified: profile&.verified || false,
          system: false, demo: SyntheticQa::Demo.user?(user) }
      end
    end
  end
end
