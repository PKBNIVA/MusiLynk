module Verification
  # Scores a verification request 0-100 from evidence that already exists in the system and
  # stores the score, its breakdown and its flags on the request. Pure evidence: it never
  # decides anything (see Verification::Evaluate) and reads only cached/fixed-host link data.
  #
  #   identity  (max 30)  phone verified 15, Google connection with verified email 15, name matches a
  #                       connected/linked account display name 10
  #   links     (max 30)  proven-ownership connection 20 (YouTube/Google channel, or Instagram
  #                       business account with >= 3 media), portfolio on >= 2 providers 10
  #   signals   (max 20)  evidence link title/author carries a name token 8, role keywords in
  #                       portfolio link titles/descriptions 6, no other user's portfolio has the
  #                       same link 6 (a duplicate scores 0 here and raises `duplicate_links`)
  #   community (max 20)  vouch from a verified musician 10, completed urgent fill/booking as the
  #                       hired party 10, a published review received 5
  class Evidence
    Result = Struct.new(:score, :breakdown, :flags, keyword_init: true)

    MAXES = { "identity" => 30, "links" => 30, "signals" => 20, "community" => 20 }.freeze
    PORTFOLIO_PROVIDERS = %w[youtube soundcloud spotify instagram].freeze
    MIN_MEDIA = 3
    FACT_LIMIT = 120

    def self.call(request) = new(request).call

    def initialize(request)
      @request = request
      @user = request.user
    end

    def call
      identity = component("identity", "phone" => phone_points, "google" => google_points, "name" => name_points)
      links = component("links", "proven_channel" => proven_channel_points, "portfolio_providers" => provider_points)
      signals = component("signals", "evidence_author" => evidence_author_points, "role_keywords" => role_keyword_points,
        "unique_links" => unique_link_points)
      community = component("community", "vouch" => vouch_points, "completed" => completed_points, "review" => review_points)
      total = [identity, links, signals, community].sum { _1["score"] }
      breakdown = { "identity" => identity, "links" => links, "signals" => signals, "community" => community, "total" => total,
                    "facts" => facts }
      flags = compute_flags
      @request.update!(evidence_score: total, evidence_breakdown: breakdown, flags:)
      Result.new(score: total, breakdown:, flags:)
    end

    private

    def component(name, parts)
      { "score" => [parts.values.sum, MAXES.fetch(name)].min, "max" => MAXES.fetch(name), "parts" => parts }
    end

    # --- identity ---

    def phone_points = @user.phone_verified_at.present? ? 15 : 0

    def google_points = connections.any? { _1.provider == "google" && _1.email_verified } ? 15 : 0

    def name_points
      names = connections.filter_map(&:display_name) + [preview[:author]].compact
      names.any? { name_matches?(_1) } ? 10 : 0
    end

    # First + last name both present, or a first name of at least 5 characters on its own.
    def name_matches?(candidate)
      haystack = candidate.to_s.downcase
      tokens = name_tokens
      return false if tokens.empty? || haystack.blank?

      full = tokens.size >= 2 && haystack.include?(tokens.first) && haystack.include?(tokens.last)
      full || (tokens.first.length >= 5 && haystack.include?(tokens.first))
    end

    def name_tokens = @name_tokens ||= @user.name.to_s.downcase.scan(/[[:alpha:]]+/)

    # --- proven-ownership links ---

    def proven_channel_points = connections.any? { proven?(_1) } ? 20 : 0

    def proven?(connection)
      raw = connection.raw.is_a?(Hash) ? connection.raw : {}
      case connection.provider
      when "youtube" then channel_id(raw).present?
      when "google" then (raw["youtube_channel_id"].presence || raw.dig("youtube", "channel_id").presence).present?
      when "instagram"
        business = raw["account_type"].to_s.casecmp?("business") || raw["business"] == true
        business && raw["media_count"].to_i >= MIN_MEDIA
      else false
      end
    end

    def channel_id(raw) = raw["channel_id"].presence || raw.dig("channel", "id").presence

    def provider_points = portfolio_providers.size >= 2 ? 10 : 0

    def portfolio_providers = @portfolio_providers ||= portfolio_urls.map { LinkPreview.provider_for(_1) }.select { PORTFOLIO_PROVIDERS.include?(_1) }.uniq

    # --- signal consistency ---

    def evidence_author_points
      text = [preview[:title], preview[:author]].compact.join(" ").downcase
      name_tokens.any? { _1.length >= 3 && text.include?(_1) } ? 8 : 0
    end

    def role_keyword_points
      text = portfolio_items.map { "#{_1.title} #{_1.description}" }.join(" ").downcase
      text += " #{preview[:title]}".downcase
      terms.any? { text.match?(/\b#{Regexp.escape(_1)}\b/) } ? 6 : 0
    end

    def terms = @terms ||= Search::Taxonomy.talent_roles.values.flat_map { _1[:terms] }.uniq

    def unique_link_points
      return 0 if duplicate_links?
      own_urls.empty? ? 0 : 6
    end

    def duplicate_links?
      return @duplicate if defined?(@duplicate)
      keys = own_urls.map { normalise(_1) }.compact.uniq
      @duplicate = keys.any? && keys.any? { |key| other_users_link?(key) }
    end

    # The normalised key is host|path|video; narrow candidates in SQL by its most specific part,
    # then compare normalised forms in Ruby.
    def other_users_link?(key)
      host, path, video = key.split("|", 3)
      needle = video.presence || path.presence || host
      like = "%#{ActiveRecord::Base.sanitize_sql_like(needle)}%"
      PortfolioItem.where.not(user_id: @user.id).where("url ILIKE ?", like).limit(200).pluck(:url).any? { normalise(_1) == key }
    end

    # Host without www, path without a trailing slash, no scheme/query/fragment (a YouTube watch
    # link keeps its `v` id).
    def normalise(url)
      uri = URI.parse(url.to_s.strip)
      return nil if uri.host.blank?
      host = uri.host.downcase.delete_prefix("www.").delete_prefix("m.")
      path = uri.path.to_s.chomp("/").downcase
      video = URI.decode_www_form(uri.query.to_s).to_h["v"] if host.end_with?("youtube.com")
      [host, path, video].join("|")
    rescue URI::InvalidURIError
      nil
    end

    # --- community ---

    def vouchers
      @vouchers ||= Vouch.where(vouchee_id: @user.id, status: %w[joined verified]).joins(voucher: :profile)
        .where(profiles: { verified: true }).includes(:voucher).map(&:voucher)
    end

    def vouch_points = vouchers.any? ? 10 : 0

    def completed_count
      @completed_count ||= Verification::Tier.completed_count(@user)
    end

    def completed_points = [completed_count * 10, 10].min

    def reviews_count = @reviews_count ||= Review.where(employer_id: @user.id, status: "published").count

    def review_points = reviews_count.positive? ? 5 : 0

    # --- flags ---

    def compute_flags
      flags = []
      flags << "duplicate_links" if duplicate_links?
      flags << "disposable_email" if Config.disposable_domains.include?(@user.email.to_s.split("@").last.to_s.downcase)
      window = Config.rate_limit.fetch(:window_days).days.ago
      flags << "velocity" if @user.verification_requests.where(created_at: window..).count >= Config.rate_limit.fetch(:max_requests)
      flags << "recently_reported" if Report.where(status: "open").where("lower(entity_type) = 'user'").exists?(entity_id: @user.id)
      flags
    end

    # --- shared inputs ---

    def connections = @connections ||= AuthConnection.where(owner: @user).to_a

    def portfolio_items = @portfolio_items ||= PortfolioItem.where(user_id: @user.id).to_a

    def portfolio_urls = portfolio_items.filter_map { _1.url.presence }

    def own_urls = [@request.evidence_url.presence, *portfolio_urls].compact.uniq

    # Title/author of the evidence link. Network only for the fixed oEmbed hosts, cached 24h;
    # any failure just means no signal.
    def preview
      @preview ||= begin
        url = @request.evidence_url.presence
        data = url ? LinkPreview.call(url) : {}
        { provider: data[:provider], title: clean(data[:title]), author: clean(data[:author]) }
      rescue StandardError
        {}
      end
    end

    def clean(value) = value.present? ? ActionController::Base.helpers.strip_tags(value.to_s).squish.first(FACT_LIMIT) : nil

    # What the summary is allowed to say: plain facts, never raw HTML.
    def facts
      channel = connections.find { proven?(_1) }
      {
        "evidence" => { "provider" => preview[:provider], "title" => preview[:title], "author" => preview[:author] }.compact,
        "channel" => channel && channel_facts(channel),
        "portfolio_providers" => portfolio_providers,
        "vouchers" => vouchers.map { _1.name.to_s.first(60) },
        "completed" => completed_count,
        "reviews" => reviews_count,
        "phone_verified" => phone_points.positive?,
        "google_verified" => google_points.positive?,
        "name_match" => name_points.positive?
      }.compact
    end

    def channel_facts(connection)
      raw = connection.raw.is_a?(Hash) ? connection.raw : {}
      stats = raw.dig("channel", "statistics") || {}
      { "provider" => connection.provider, "name" => clean(connection.display_name || raw.dig("channel", "title")),
        "videos" => stats["videoCount"] || raw["media_count"], "since" => raw.dig("channel", "publishedAt").to_s[0, 4].presence }.compact
    end
  end
end
