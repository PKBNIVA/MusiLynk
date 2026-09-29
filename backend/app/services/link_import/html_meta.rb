require "nokogiri"

# Reads what a public page says about itself, for LinkImport::Resolver's generic-page and
# link-in-bio handling. Only ever fed HTML that LinkImport::SafeFetch already fetched safely —
# this class only parses, it never fetches.
module LinkImport
  class HtmlMeta
    # { title:, description:, image:, siteName:, personName: } — every value plain text (or an
    # https URL for image), length-capped, or nil.
    def self.extract(html)
      doc = Nokogiri::HTML5(html.to_s, max_tree_depth: 2_000)
      meta = ->(name) { doc.at_css("meta[property='#{name}'], meta[name='#{name}']")&.attr("content") }
      json_ld = extract_json_ld_person(doc)

      {
        title: clean(meta.call("og:title") || doc.at_css("title")&.text, 160) || json_ld[:name],
        description: clean(meta.call("og:description") || meta.call("description") || meta.call("twitter:description"), 600) || json_ld[:description],
        image: clean_url(meta.call("og:image") || meta.call("twitter:image") || json_ld[:image]),
        siteName: clean(meta.call("og:site_name"), 120),
        personName: json_ld[:name]
      }
    rescue StandardError
      { title: nil, description: nil, image: nil, siteName: nil, personName: nil }
    end

    # Every distinct https outbound <a href>, deduplicated, excluding the page's own host and
    # common utility links (mailto/tel/anchors/the host's own share or app-store buttons).
    def self.outbound_links(html, source_url)
      doc = Nokogiri::HTML5(html.to_s, max_tree_depth: 2_000)
      own_host = URI.parse(source_url).host.to_s.downcase
      seen = {}
      doc.css("a[href]").each do |node|
        href = node.attr("href").to_s.strip
        next if href.blank?
        begin
          uri = URI.join(source_url, href)
        rescue URI::InvalidURIError
          next
        end
        next unless uri.scheme == "https" && uri.host.present?
        host = uri.host.downcase
        next if host == own_host || UTILITY_HOSTS.any? { host.end_with?(_1) }
        seen[uri.to_s] ||= true
      end
      seen.keys
    end

    UTILITY_HOSTS = %w[apps.apple.com play.google.com facebook.com/sharer twitter.com/intent linktr.ee/s].freeze

    def self.extract_json_ld_person(doc)
      doc.css("script[type='application/ld+json']").each do |node|
        data = JSON.parse(node.text.to_s)
        candidates = data.is_a?(Array) ? data : [data]
        candidates.each do |item|
          next unless item.is_a?(Hash)
          type = item["@type"]
          types = type.is_a?(Array) ? type : [type]
          next unless (types & %w[Person MusicGroup]).any?
          return { name: clean(item["name"], 160), description: clean(item["description"], 600), image: item["image"] }
        end
      end
      {}
    rescue JSON::ParserError, StandardError
      {}
    end

    def self.clean(value, limit)
      return nil unless value.is_a?(String)
      text = value.gsub(/\s+/, " ").strip
      text.presence&.truncate(limit, omission: "…")
    end

    def self.clean_url(value)
      return nil unless value.is_a?(String)
      uri = URI.parse(value)
      uri.scheme == "https" && uri.host.present? ? uri.to_s : nil
    rescue URI::InvalidURIError
      nil
    end
  end
end
