# POST /api/library/import { headline?, bio?, roles?, genres?, instruments?, credits?, items? }
#
# Applies a reviewed LinkImport::ProfileDraft to a signed-in account's library and profile:
# - items become portfolio items; a URL already in the library is skipped, so re-running the
#   import (or the draft step twice) never duplicates a work sample.
# - roles/genres/instruments/credits are merged into the profile — added to, never replacing,
#   whatever is already there.
# - headline/bio are only ever set directly when the field is still blank; otherwise a
#   ShowcaseSuggestion (kind "profile_fields") is raised so nothing overwrites text the person
#   already wrote.
class LibraryImportsController < ApplicationController
  before_action -> { authenticate!("jobseeker", "employer") }

  MAX_ITEMS = 8
  LIST_FIELDS = %i[roles genres instruments].freeze

  def create
    return unless throttle!("library-import")

    profile = current_user.profile || current_user.create_profile!
    result = ApplicationRecord.transaction do
      profile.lock!
      created_items = create_items(profile)
      merge_lists!(profile)
      suggested = apply_text_fields!(profile)
      profile.save!
      { items: created_items, suggested: }
    end

    render json: { portfolioItems: PortfolioItem.preload_image_sets(result[:items]).map(&:api_json), suggestedReview: result[:suggested] }
  end

  private

  def raw_items = Array(params[:items]).first(MAX_ITEMS).map { |item| item.is_a?(ActionController::Parameters) ? item.to_unsafe_h : item }.select { _1.is_a?(Hash) }

  def create_items(profile)
    count = current_user.portfolio_items.count
    raw_items.filter_map.with_index do |item, index|
      url = LinkPreview.normalize(item["url"] || item[:url])
      next if current_user.portfolio_items.exists?(url:)

      provider = LinkPreview.provider_for(url)
      cached = LinkPreview.cached(url) || {}
      title = LinkPreview.clean_text(item["title"] || item[:title], LinkPreview::TITLE_LIMIT) || cached[:title] ||
        LinkPreview.default_title(url, provider)
      description = LinkPreview.clean_text(item["caption"] || item[:caption], 2_000)
      thumbnail = LinkPreview.clean_thumbnail(item["thumbnail"] || item[:thumbnail]) || cached[:thumbnail]

      current_user.portfolio_items.create!(kind: LinkPreview.kind_for(provider), title:, description:, url:, thumbnail_url: thumbnail,
        visibility: "public", sort_order: count + index, media_metadata: { "source" => "library_import", "provider" => provider })
    rescue LinkPreview::InvalidUrl
      nil
    end
  end

  def merge_lists!(profile)
    LIST_FIELDS.each do |field|
      incoming = Array(params[field]).map { _1.to_s.strip }.reject(&:blank?)
      next if incoming.empty?
      have = Array(profile[field])
      profile[field] = have + incoming.reject { |value| have.any? { _1.to_s.casecmp?(value) } }
    end

    incoming_credits = Array(params[:credits]).filter_map do |credit|
      credit = credit.is_a?(ActionController::Parameters) ? credit.to_unsafe_h : credit
      next unless credit.is_a?(Hash)
      text = (credit["text"] || credit[:text]).to_s.strip
      text.presence
    end
    return if incoming_credits.empty?

    have = Array(profile.credits)
    profile.credits = have + incoming_credits.reject { |value| have.any? { _1.to_s.casecmp?(value) } }
  end

  # Returns the ShowcaseSuggestion created for headline/bio, if any (nil when both were blank
  # and applied directly, or when the draft offered nothing for either).
  def apply_text_fields!(profile)
    headline = params[:headline].to_s.strip.presence
    bio = params[:bio].to_s.strip.presence
    return nil unless headline || bio

    direct = {}
    proposed = {}
    direct[:headline] = headline.truncate(160) if headline && profile.headline.blank?
    proposed[:headline] = headline if headline && profile.headline.present?
    direct[:bio] = bio.truncate(2_000) if bio && profile.bio.blank?
    proposed[:bio] = bio if bio && profile.bio.present?

    profile.assign_attributes(direct) if direct.any?
    return nil if proposed.empty?

    suggestion = ShowcaseSuggestion.raise!(owner_type: "user", owner_id: current_user.id, target: profile, subject: profile,
      kind: "profile_fields", reason: "Drafted from your work links.", payload: proposed)
    suggestion.api_json
  end
end
