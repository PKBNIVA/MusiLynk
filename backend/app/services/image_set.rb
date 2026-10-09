# The responsive-image payload for an upload that has variants (ImageVariantsJob):
#   { src:, srcset: { avif: ["<url> 320w", ...], webp: [...] }, width:, height: }
# `src` is the original (every browser can show it), the srcsets are the variants, width x height
# the original's size so the client can reserve the box. Nil for uploads without variants, so the
# payload's old `url`/`photoUrl` strings stay the only thing a client needs.
#
# Profiles, acts and work samples point at uploads by public URL, so a page of them is resolved
# with one query through .by_url; posts hold upload ids (.by_id).
module ImageSet
  module_function

  def for(upload)
    return nil unless upload&.public_url.present? && upload.variants.is_a?(Hash) && upload.variants["formats"].present?
    formats = upload.variants["formats"]
    srcset = formats.filter_map do |format, widths|
      next if widths.blank?
      [format, widths.map { |width| "#{upload.variant_url(width, format)} #{width}w" }]
    end.to_h
    return nil if srcset.empty?
    { src: upload.public_url, srcset: srcset, width: upload.variants["width"], height: upload.variants["height"] }
  end

  # { public_url => image set } for the finished uploads among `urls` that have variants. One query;
  # an empty list of URLs runs none.
  def by_url(urls) = from_uploads(Upload.variants_by_url(urls))

  # { public_url => image set } for the uploads (a loaded list or relation) that have image variants.
  def from_uploads(uploads) = uploads.to_h { [_1.public_url, ImageSet.for(_1)] }.compact
end
