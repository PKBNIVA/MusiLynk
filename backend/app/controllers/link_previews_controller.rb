# POST /api/link-previews {url} -> {provider, kind, label, url, title, author, thumbnail}
#
# Public, because the sign-up asks for work links before the account exists; rate-limited per IP.
# See LinkPreview for what is fetched (only fixed oEmbed hosts) and what is kept.
class LinkPreviewsController < ApplicationController
  PREVIEWS_PER_IP = 60
  PERIOD = 10.minutes

  def create
    return unless throttle!("link-preview", limit: PREVIEWS_PER_IP, period: PERIOD)
    raw = params[:url]
    return render_error("Paste a link to your work.", :unprocessable_content, "INVALID_URL", fields: { url: ["Paste a link to your work."] }) unless raw.is_a?(String)

    preview = LinkPreview.call(raw)
    render json: preview.merge(label: LinkPreview.label_for(preview[:provider]))
  rescue LinkPreview::InvalidUrl => error
    render_error(error.message, :unprocessable_content, "INVALID_URL", fields: { url: [error.message] })
  end
end
