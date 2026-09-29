# One pending change in an owner's "review changes" inbox (see ShowcaseSync):
# - kind "include": add the subject (a work sample or career entry) to the target portfolio or
#   resume. Accepting pins it there.
# - kind "tags": add the payload's values (tags, roles, genres, instruments) to the target work
#   sample. Accepting updates the item, which may then join portfolios by their rules.
# - kind "profile_fields": propose a new headline/bio (from LinkImport::ProfileDraft, applied via
#   POST /api/library/import) when the person already has one of their own — accepting fills it
#   in only if it is *still* blank, so nothing here ever overwrites what someone wrote themselves.
#   Target and subject are both the same profile: there is no separate "subject" for a profile
#   text suggestion, and self-referencing keeps the (target, subject, kind) row unique per person.
# There is one row per (target, subject, kind), so a rejected suggestion is never raised again.
class ShowcaseSuggestion < ApplicationRecord
  KINDS = %w[include tags profile_fields].freeze
  STATUSES = %w[pending accepted rejected obsolete].freeze
  TARGET_TYPES = %w[portfolio resume portfolio_item profile].freeze
  SUBJECT_TYPES = %w[portfolio_item career_entry profile].freeze
  TAG_FACETS = %w[tags roles genres instruments].freeze

  attribute :payload, :json, default: -> { {} }
  validates :kind, inclusion: { in: KINDS }
  validates :status, inclusion: { in: STATUSES }
  validates :target_type, inclusion: { in: TARGET_TYPES }
  validates :subject_type, inclusion: { in: SUBJECT_TYPES }
  validates :owner_type, inclusion: { in: PageDirectory::OWNER_TYPES }

  scope :pending, -> { where(status: "pending") }
  scope :owned_by, ->(actor) { where(owner_type: actor.type, owner_id: actor.id) }

  # Creates the suggestion, or refreshes a pending one. Accepted, rejected and obsolete ones stay
  # as they are, so a person is not asked the same thing twice.
  def self.raise!(owner_type:, owner_id:, target:, subject:, kind:, reason:, payload: {})
    key = { target_type: type_name(target), target_id: target.id, subject_type: type_name(subject), subject_id: subject.id, kind: }
    suggestion = find_or_initialize_by(key)
    return suggestion if suggestion.persisted? && suggestion.status != "pending"
    suggestion.update!(owner_type:, owner_id:, reason: reason.to_s.first(255), payload:, status: "pending")
    suggestion
  rescue ActiveRecord::RecordNotUnique
    find_by(key) # raised concurrently by another sync
  end

  def self.type_name(record) = record.class.name.underscore

  def target
    @target ||= case target_type
                when "portfolio" then Portfolio.find_by(id: target_id)
                when "resume" then Resume.find_by(id: target_id)
                when "portfolio_item" then PortfolioItem.find_by(id: target_id)
                when "profile" then Profile.find_by(user_id: target_id)
                end
  end

  def subject
    @subject ||= case subject_type
                 when "career_entry" then CareerEntry.find_by(id: subject_id)
                 when "profile" then Profile.find_by(user_id: subject_id)
                 else PortfolioItem.find_by(id: subject_id)
                 end
  end

  # Applies the change. Returns false (and marks it obsolete) when its target or subject is gone.
  def accept!
    transaction do
      lock!
      return true unless status == "pending"
      unless target && subject
        update!(status: "obsolete", resolved_at: Time.current)
        return false
      end
      case kind
      when "tags" then apply_tags
      when "profile_fields" then apply_profile_fields
      else apply_include
      end
      update!(status: "accepted", resolved_at: Time.current)
    end
    true
  end

  def reject!
    update!(status: "rejected", resolved_at: Time.current) if status == "pending"
  end

  def api_json
    {
      id:, kind:, status:, reason:, payload:, createdAt: created_at, resolvedAt: resolved_at,
      target: { type: target_type, id: target_id, title: title_of(target) },
      subject: { type: subject_type, id: subject_id, title: title_of(subject) }
    }
  end

  private

  def apply_include
    pins, excludes = target.is_a?(Resume) ? %i[pinned_entry_ids excluded_entry_ids] : %i[pinned_item_ids excluded_item_ids]
    target.lock!
    target.update!(pins => Array(target[pins]) | [subject_id], excludes => Array(target[excludes]) - [subject_id])
  end

  def apply_tags
    item = target
    item.lock!
    changes = TAG_FACETS.each_with_object({}) do |facet, out|
      values = Array(payload[facet]).grep(String)
      next if values.empty?
      have = Array(item[facet])
      out[facet] = have + values.reject { |value| have.any? { _1.to_s.casecmp?(value) } }
    end
    item.update!(changes) if changes.any?
  end

  def title_of(record)
    case record
    when Portfolio, Resume, PortfolioItem then record.title
    when CareerEntry then record.label
    when Profile then record.headline.presence || "Profile"
    end
  end

  # Accepting never overwrites text the person has since written themselves — only fills in a
  # field that is still blank at the moment of acceptance.
  def apply_profile_fields
    profile = target
    profile.lock!
    changes = {}
    changes[:headline] = payload["headline"].to_s.truncate(160) if profile.headline.blank? && payload["headline"].present?
    changes[:bio] = payload["bio"].to_s.truncate(2_000) if profile.bio.blank? && payload["bio"].present?
    profile.update!(changes) if changes.any?
  end
end
