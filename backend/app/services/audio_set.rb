# The audio payload for an upload that has audio variants (AudioVariantsJob):
#   { preview: "<url>/v/preview.m4a", full: "<url>/v/full.m4a" | nil, peaks: "<url>/v/peaks.json", duration: 123.4 }
# `preview` is the 30 s clip the player starts with, `full` the AAC transcode of an uncompressed
# original (nil when the original itself is the full track, e.g. an MP3), `peaks` the waveform JSON
# and `duration` the track length in seconds. Nil for uploads without audio variants, so the
# payload's old `url` string stays the only thing a client needs.
module AudioSet
  module_function

  def for(upload)
    return nil unless upload&.public_url.present? && upload.variants.is_a?(Hash) && upload.variants["audio"].is_a?(Hash)
    audio = upload.variants["audio"]
    produced = Array(audio["variants"])
    return nil unless produced.include?("preview")
    {
      preview: upload.audio_variant_url("preview"),
      full: produced.include?("full") ? upload.audio_variant_url("full") : nil,
      peaks: produced.include?("peaks") ? upload.audio_variant_url("peaks") : nil,
      duration: audio["duration"]&.to_f
    }
  end

  # { public_url => audio set } for the finished uploads among `urls` that have audio variants.
  # One query; an empty list of URLs runs none.
  def by_url(urls)
    urls = Array(urls).compact_blank.uniq
    return {} if urls.empty?
    Upload.complete.where(public_url: urls).where.not(variants: {}).to_h { [_1.public_url, AudioSet.for(_1)] }.compact
  end
end
