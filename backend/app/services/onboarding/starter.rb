# The two-minute sign-up's answers, applied to a new account: the musician's roles, city, years
# and work links (which become a starter portfolio), or the hirer's kind of business, city and
# company (which becomes their organization Page).
#
# Used by POST /api/auth/register (password sign-up, in the same transaction as the account) and
# POST /api/onboarding/starter (after an email-code sign-up). Everything is optional: an empty
# starter changes nothing, so the old register payload keeps working.
module Onboarding
  class Starter
    MAX_LINKS = 5
    MAX_ROLES = 8
    ROLE_LIMIT = 60
    MAX_YEARS = 80
    HIRER_KINDS = {
      "studio" => "Recording studio", "event_company" => "Event and wedding company", "band" => "Band or artist",
      "label" => "Music label", "venue" => "Venue", "other" => "Hiring for music work"
    }.freeze
    PERMITTED = [:city, :yearsExperience, :headline, :bio, :hirerKind, :companyName, { roles: [] },
      { genres: [] }, { instruments: [] },
      { links: [:url, :title, :thumbnail, :caption] }].freeze

    attr_reader :errors

    # `params` is ActionController::Parameters (or a Hash) holding the starter fields. Links are
    # objects ({url, title?, thumbnail?, caption?}) or plain URL strings; credits (like a drafted
    # profile's) are plain strings or {text, source_url} objects — only the text ever gets kept
    # (see #credits), so both shapes are read straight off the raw params rather than fought
    # through `permit`'s single fixed shape for an array.
    def self.from_params(params)
      source = params.respond_to?(:permit) ? params.permit(*PERMITTED).to_h : params.to_h
      raw_links = params[:links]
      source["links"] = raw_links if raw_links.is_a?(Array) && raw_links.any? && raw_links.all?(String)
      raw_credits = params[:credits]
      source["credits"] = raw_credits if raw_credits.is_a?(Array)
      new(source.with_indifferent_access)
    end

    def initialize(input)
      @input = input
      @errors = {}
    end

    def any? = %i[roles city yearsExperience headline bio hirerKind companyName links].any? { @input[_1].present? }

    # Field errors keyed by the request's camelCase name; empty when everything is usable.
    def validate(role)
      @errors = {}
      add(:roles, "Choose up to #{MAX_ROLES} roles.") if roles_raw.length > MAX_ROLES
      add(:roles, "Keep each role under #{ROLE_LIMIT} characters.") if roles.any? { _1.length > ROLE_LIMIT }
      add(:city, "Keep the city under 120 characters.") if city.length > 120
      add(:companyName, "Keep the name under 120 characters.") if company_name.length > 120
      validate_years
      add(:hirerKind, "Choose one of: #{HIRER_KINDS.keys.join(', ')}.") if hirer_kind.present? && !HIRER_KINDS.key?(hirer_kind)
      validate_links(role)
      @errors
    end

    def valid?(role) = validate(role).empty?

    # Applies the answers inside the caller's transaction. Returns what was created.
    def apply!(user)
      profile = user.profile || user.create_profile!
      user.jobseeker? ? apply_talent(user, profile) : apply_hirer(user, profile)
    end

    private

    def add(field, message) = (@errors[field.to_s] ||= []) << message

    def roles_raw = Array(@input[:roles]).select { _1.is_a?(String) }
    def roles = roles_raw.map(&:strip).reject(&:empty?).uniq(&:downcase)
    def genres = Array(@input[:genres]).select { _1.is_a?(String) }.map(&:strip).reject(&:empty?).uniq(&:downcase)
    def instruments = Array(@input[:instruments]).select { _1.is_a?(String) }.map(&:strip).reject(&:empty?).uniq(&:downcase)
    # A draft credit may be a plain string or a {text, source_url} object (LinkImport::ProfileDraft);
    # only the text is stored — Profile#credits is a flat list, same as when typed by hand.
    def credits
      Array(@input[:credits]).filter_map do |entry|
        text = entry.respond_to?(:[]) && !entry.is_a?(String) ? (entry[:text] || entry["text"]) : entry
        text.to_s.strip.presence
      end.uniq(&:downcase)
    end
    def city = @input[:city].to_s.strip
    def company_name = @input[:companyName].to_s.strip
    def hirer_kind = @input[:hirerKind].to_s.strip

    def years
      raw = @input[:yearsExperience]
      return nil if raw.blank?
      Integer(raw.to_s, exception: false)
    end

    def validate_years
      raw = @input[:yearsExperience]
      return if raw.blank?
      value = years
      add(:yearsExperience, "Years of experience must be a whole number from 0 to #{MAX_YEARS}.") unless value && value.between?(0, MAX_YEARS)
    end

    def links
      @links ||= Array(@input[:links]).first(MAX_LINKS + 1).map do |entry|
        entry.is_a?(Hash) ? entry.with_indifferent_access.slice(:url, :title, :thumbnail, :caption) : { url: entry.to_s }.with_indifferent_access
      end
    end

    def validate_links(role)
      return if links.empty?
      return add(:links, "Work links are for musician and crew accounts.") unless role.to_s == "jobseeker"
      return add(:links, "Add up to #{MAX_LINKS} links.") if links.length > MAX_LINKS
      links.each_with_index do |link, index|
        url = LinkPreview.normalize(link[:url])
        add(:links, "Link #{index + 1}: add uploaded files from your portfolio after you sign up.") if PortfolioItem.storage_url?(url)
      rescue LinkPreview::InvalidUrl => error
        add(:links, "Link #{index + 1}: #{error.message}")
      end
    end

    def apply_talent(user, profile)
      profile.roles = (Array(profile.roles) + roles).uniq(&:downcase).first(MAX_ROLES) if roles.any?
      profile.genres = merge_unique(profile.genres, genres) if genres.any?
      profile.instruments = merge_unique(profile.instruments, instruments) if instruments.any?
      profile.credits = merge_unique(profile.credits, credits) if credits.any?
      profile.location = city if city.present?
      unless years.nil?
        profile.years_experience = years
        profile.experience = "#{years} #{years == 1 ? 'year' : 'years'}" if profile.experience.blank?
      end
      fill_text(profile, :headline, 160)
      fill_text(profile, :bio, 2_000)
      # Sending the same answers twice (a retried request) never duplicates a work sample.
      items = links.each_with_index.filter_map { |link, index| create_item(user, link, index) }
      profile.portfolio_url = items.first.url if items.any? && profile.portfolio_url.blank?
      profile.save!
      user.update!(profile_complete: true) if roles.any? && profile.location.present?
      { portfolioItems: items.length, organizationId: nil }
    end

    def apply_hirer(user, profile)
      kind_label = HIRER_KINDS[hirer_kind]
      profile.location = city if city.present?
      profile.company_name = company_name if company_name.present?
      if profile.headline.blank? && kind_label
        profile.headline = [kind_label, city.presence].compact.join(" · ").truncate(160)
      end
      fill_text(profile, :bio, 2_000)
      profile.save!
      organization = create_organization(user) if company_name.present?
      user.update!(profile_complete: true) if company_name.present?
      { portfolioItems: 0, organizationId: organization&.id }
    end

    def merge_unique(have, incoming)
      have = Array(have)
      have + incoming.reject { |value| have.any? { _1.to_s.casecmp?(value) } }
    end

    def fill_text(profile, field, limit)
      value = @input[field].to_s.strip
      profile[field] = value.truncate(limit, omission: "") if value.present? && profile[field].blank?
    end

    def create_organization(user)
      organization = Organization.create!(owner: user, name: company_name, org_type: hirer_kind.presence, city: city.presence, status: "active")
      organization.organization_members.create!(user:, role: "owner")
      organization
    end

    # One work sample from a pasted link. The title comes from the client's preview when given
    # (plain text, capped like any title), else from a cached server preview, else the service.
    def create_item(user, link, index)
      url = LinkPreview.normalize(link[:url])
      return nil if user.portfolio_items.exists?(url:)
      provider = LinkPreview.provider_for(url)
      cached = LinkPreview.cached(url) || {}
      title = LinkPreview.clean_text(link[:title], LinkPreview::TITLE_LIMIT) || cached[:title] ||
        LinkPreview.default_title(url, provider, plain: provider == "link" ? "to my work" : "work sample")
      thumbnail = LinkPreview.clean_thumbnail(link[:thumbnail]) || cached[:thumbnail]
      thumbnail = nil if thumbnail && PortfolioItem.storage_url?(thumbnail)
      description = LinkPreview.clean_text(link[:caption], 2_000)
      user.portfolio_items.create!(kind: LinkPreview.kind_for(provider), title:, description:, url:, thumbnail_url: thumbnail,
        credited_as: roles.first, roles: roles.first(3), visibility: "public", sort_order: index, featured: index.zero?,
        media_metadata: { "source" => "signup", "provider" => provider })
    end
  end
end
