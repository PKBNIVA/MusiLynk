# One pending change in an owner's "review changes" inbox (see ShowcaseSync):
# - kind "include": add the subject (a work sample or career entry) to the target portfolio or
#   resume. Accepting pins it there.
# - kind "tags": add the payload's values (tags, roles, genres, instruments) to the target work
#   sample. Accepting updates the item, which may then join portfolios by their rules.
# There is one row per (target, subject, kind), so a rejected suggestion is never raised again.
class ShowcaseSuggestion < ApplicationRecord
  KINDS = %w[include tags].freeze
  STATUSES = %w[pending accepted rejected obsolete].freeze
  TARGET_TYPES = %w[portfolio resume portfolio_item].freeze
  SUBJECT_TYPES = %w[portfolio_item career_entry].freeze
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
                end
  end

  def subject
    @subject ||= subject_type == "career_entry" ? CareerEntry.find_by(id: subject_id) : PortfolioItem.find_by(id: subject_id)
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
      kind == "tags" ? apply_tags : apply_include
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
    end
  end
end
