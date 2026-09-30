require "net/http"

module SyntheticQa
  # Where the demo work samples play from.
  #
  # ccMixter refuses its MP3s (HTTP 403) to any page that is not on ccmixter.org: with no Referer or with
  # Verse's Referer the browser gets an HTML error page, so a plain <audio src> pointing at ccmixter.org
  # never plays. CC BY allows redistribution with attribution (the credit travels with every sample in
  # `credited_as` and the description), so when the app has object storage (AWS_BUCKET, i.e. Cloudflare R2
  # in production) the seeder copies the forty tracks once into the bucket under demo/showcase/ and the
  # samples point there. Without a bucket (a local Disk stack) the samples keep the ccMixter link: labels,
  # credits and waveforms render, audio does not play cross-site.
  #
  # The audio is never committed; only tracks.yml (titles, licences, URLs, peaks) is. The objects live
  # outside uploads/, so the upload sweeper never touches them, and they are shared by every showcase
  # batch: deleting a batch leaves the forty files in place for the next one.
  module TrackMirror
    class Error < StandardError; end

    REFERER = "https://ccmixter.org/".freeze
    KEY_PREFIX = "demo/showcase/".freeze
    CACHE_CONTROL = "public, max-age=31536000, immutable".freeze
    MIN_BYTES = 10.kilobytes
    MAX_BYTES = 25.megabytes

    module_function

    def enabled? = UploadStorage.direct? && UploadStorage.ready?

    def key_for(track) = "#{KEY_PREFIX}#{track.fetch('id')}.mp3"

    # The URL a work sample uses for this track.
    def url_for(track) = enabled? ? UploadStorage.public_url_for(key_for(track)) : track.fetch("url")

    # Copies every track that is not in the bucket yet. Raises Error on the first one that cannot be copied
    # (so seeding stops before any account exists) and returns the number of tracks it copied.
    def mirror!(tracks, fetcher: method(:download))
      return 0 unless enabled?

      client = UploadStorage.client
      tracks.count do |track|
        key = key_for(track)
        next false if present?(client, key)

        body = fetcher.call(track.fetch("url"))
        client.put_object(bucket: UploadStorage.bucket, key:, body:, content_type: "audio/mpeg", cache_control: CACHE_CONTROL)
        Rails.logger.info({ event: "demo_showcase.track_mirrored", id: track.fetch("id"), bytes: body.bytesize }.to_json)
        true
      end
    rescue Aws::Errors::ServiceError => e
      raise Error, "Could not write the demo tracks to the bucket: #{e.message}"
    end

    def present?(client, key)
      client.head_object(bucket: UploadStorage.bucket, key:).content_length.to_i.positive?
    rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchKey
      false
    end

    # The MP3 bytes from ccMixter, requested the way its own pages request them.
    def download(url)
      uri = URI.parse(url)
      raise Error, "#{url} is not a ccMixter HTTPS link." unless uri.is_a?(URI::HTTPS) && uri.host == "ccmixter.org"

      response = Net::HTTP.start(uri.host, uri.port, use_ssl: true, open_timeout: 10, read_timeout: 60) do |http|
        http.request(Net::HTTP::Get.new(uri, "Referer" => REFERER, "User-Agent" => "Verse demo seeder"))
      end
      raise Error, "ccMixter answered #{response.code} for #{url}." unless response.is_a?(Net::HTTPSuccess)

      body = response.body.to_s.b
      raise Error, "#{url} is not a usable MP3 (#{body.bytesize} bytes)." unless body.bytesize.between?(MIN_BYTES, MAX_BYTES) && MediaTypeSniffer.detect(body.byteslice(0, MediaTypeSniffer::HEADER_BYTES)) == "audio/mpeg"

      body
    rescue URI::InvalidURIError, SocketError, SystemCallError, Timeout::Error, OpenSSL::SSL::SSLError => e
      raise Error, "Could not download #{url}: #{e.message}"
    end
  end
end
