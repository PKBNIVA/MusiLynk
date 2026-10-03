# The product name, for text that is composed in code (sender names, system author, share pages).
# Static copy that simply mentions the product stays literal.
module Brand
  NAME = "MusiLynk".freeze

  # The logo's tile colour, written by `npm run brand:build` from brand/logo/logo.config.json (the
  # one source of the logo). Emails paint it behind the header mark so the header keeps its shape
  # when images are blocked.
  LOGO = JSON.parse(File.read(File.expand_path("../brand_logo.json", __dir__))).freeze
  TILE_COLOR = LOGO.fetch("tileColor").freeze
end
