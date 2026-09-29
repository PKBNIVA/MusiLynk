# Public "I'm verified on Verse" share cards for Instagram/WhatsApp (ShareCard). Only served for
# a user whose profile is verified and who has consented to sharing that publicly
# (share_verification_publicly); anyone else 404s, same as an unpublished record. Cached at the
# edge for 24h since the badge and profile basics rarely change within a day.
#
# Served as SVG only; the browser rasterises it to a PNG for download (src/app/lib/shareCard.ts).
class ShareCardsController < ActionController::API
  CACHE_CONTROL = "public, max-age=86400, immutable".freeze

  def verified
    render_card(:story)
  end

  def landscape
    render_card(:landscape)
  end

  private

  def render_card(variant)
    user = User.joins(:profile).where(profiles: { verified: true, share_verification_publicly: true }).find_by(id: params[:user_id])
    return head :not_found unless user

    svg = variant == :story ? ShareCard.story(user) : ShareCard.landscape(user)
    response.set_header("Cache-Control", CACHE_CONTROL)
    render plain: svg, content_type: "image/svg+xml"
  end
end
