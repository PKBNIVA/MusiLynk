# Renders the "I'm verified on MusiLynk" share card for Instagram/WhatsApp — a 1080x1920 story
# card and a 1200x630 landscape variant, both as inline SVG.
#
# The production image (backend/Dockerfile) has no headless browser and no ImageMagick, so this
# does not render through Playwright/Chromium or convert to PNG: it builds the card directly as
# SVG (dark background matching the site's theme, the wordmark, the musician's name/roles/city,
# a short profile URL and a QR code via rqrcode) and ShareCardsController serves it as
# `image/svg+xml`; the SPA rasterises it to PNG client-side. Only system fonts and no external
# <image> hrefs are used, so drawing it on a canvas does not taint it.
class ShareCard
  BACKGROUND = "#0a0a0a".freeze
  PRIMARY = "#6747e8".freeze
  FOREGROUND = "#f5f5f5".freeze
  MUTED = "#9a9aa5".freeze

  STORY = { width: 1080, height: 1920 }.freeze
  LANDSCAPE = { width: 1200, height: 630 }.freeze

  def self.story(user) = new(user).story_svg
  def self.landscape(user) = new(user).landscape_svg

  def initialize(user)
    @user = user
    @profile = user.profile
  end

  def story_svg = render(STORY, qr_size: 300, layout: :portrait)
  def landscape_svg = render(LANDSCAPE, qr_size: 180, layout: :landscape)

  def profile_url = "#{FrontendUrl.base}/professionals/#{user.id}"

  private

  attr_reader :user, :profile

  def render(dims, qr_size:, layout:)
    width, height = dims[:width], dims[:height]
    qr = qr_svg_group(x: layout == :portrait ? (width - qr_size) / 2 : width - qr_size - 96,
      y: layout == :portrait ? height - qr_size - 160 : (height - qr_size) / 2, size: qr_size)

    text_x = layout == :portrait ? width / 2 : 96
    anchor = layout == :portrait ? "middle" : "start"
    name_y = layout == :portrait ? 760 : height / 2 - 60
    roles = Array(profile&.roles).first(3).join(" · ")
    city = profile&.location.presence

    <<~SVG
      <svg xmlns="http://www.w3.org/2000/svg" width="#{width}" height="#{height}" viewBox="0 0 #{width} #{height}">
        <rect width="#{width}" height="#{height}" fill="#{BACKGROUND}"/>
        <rect width="#{width}" height="6" fill="#{PRIMARY}"/>
        <text x="#{text_x}" y="140" text-anchor="#{anchor}" font-family="Helvetica, Arial, sans-serif" font-size="44" font-weight="700" fill="#{FOREGROUND}">MusiLynk</text>
        <rect x="#{text_x - (anchor == 'middle' ? 110 : 0)}" y="190" width="220" height="52" rx="26" fill="#{PRIMARY}"/>
        <text x="#{text_x}" y="225" text-anchor="#{anchor == 'middle' ? 'middle' : 'start'}" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="600" fill="#ffffff">Verified on MusiLynk</text>
        <text x="#{text_x}" y="#{name_y}" text-anchor="#{anchor}" font-family="Helvetica, Arial, sans-serif" font-size="64" font-weight="700" fill="#{FOREGROUND}">#{escape(user.name)}</text>
        #{roles.present? ? %(<text x="#{text_x}" y="#{name_y + 70}" text-anchor="#{anchor}" font-family="Helvetica, Arial, sans-serif" font-size="34" fill="#{MUTED}">#{escape(roles)}</text>) : ""}
        #{city ? %(<text x="#{text_x}" y="#{name_y + 118}" text-anchor="#{anchor}" font-family="Helvetica, Arial, sans-serif" font-size="30" fill="#{MUTED}">#{escape(city)}</text>) : ""}
        #{qr}
        <text x="#{text_x}" y="#{height - 60}" text-anchor="#{anchor}" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#{MUTED}">#{escape(short_url)}</text>
      </svg>
    SVG
  end

  def qr_svg_group(x:, y:, size:)
    margin = (size * 0.06).round(2)
    inner = size - (margin * 2)
    qr = RQRCode::QRCode.new(profile_url)
    modules = qr.qrcode.modules
    cell = inner.to_f / modules.length
    cells = modules.each_with_index.flat_map do |row, ry|
      row.each_with_index.filter_map do |dark, rx|
        next unless dark
        %(<rect x="#{(rx * cell).round(2)}" y="#{(ry * cell).round(2)}" width="#{cell.ceil(2)}" height="#{cell.ceil(2)}" fill="#000"/>)
      end
    end.join
    <<~SVG
      <g transform="translate(#{x}, #{y})">
        <rect width="#{size}" height="#{size}" fill="#fff" rx="16"/>
        <g transform="translate(#{margin}, #{margin})">#{cells}</g>
      </g>
    SVG
  end

  def short_url = profile_url.sub(%r{^https?://}, "")

  def escape(text) = CGI.escapeHTML(text.to_s)
end
