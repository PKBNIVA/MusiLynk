# A resume is a view over the person's one career record (career_entries) for one kind of work:
# entries matching `rules` (ShowcaseRules over kinds and tags), plus `pinned_entry_ids`, minus
# `excluded_entry_ids`, grouped into sections in `section_order`. headline and summary are
# overrides; NULL inherits the profile (headline, and bio as the summary). An optional PDF comes
# from the person's own uploads. Resumes are private; an employer only sees the snapshot sent with
# an application (Application.materials_snapshot).
class Resume < ApplicationRecord
  MAX_PER_USER = 20
  MAX_LISTED_IDS = 500
  INHERITED = %w[headline summary].freeze
  DIMS = %w[kinds tags].freeze
  SORTS = %w[newest manual].freeze
  DEFAULT_SECTION_ORDER = %w[experience credit award education skill gear language link].freeze
  TEXT_LIMITS = { title: 120, target_role: 120, headline: 160, summary: 3_000 }.freeze
  # A new resume shows the whole record until the person narrows it.
  DEFAULT_RULES = { "everything" => true, "sort" => "newest" }.freeze

  belongs_to :user
  belongs_to :upload, optional: true
  attribute :rules, :json, default: -> { DEFAULT_RULES.dup }
  attribute :pinned_entry_ids, :json, default: -> { [] }
  attribute :excluded_entry_ids, :json, default: -> { [] }
  attribute :entry_order, :json, default: -> { [] }
  attribute :section_order, :json, default: -> { [] }

  normalizes :title, :target_role, :headline, :summary, with: ->(value) { value.to_s.strip.presence }

  validates :title, presence: true
  TEXT_LIMITS.each { |field, maximum| validates field, length: { maximum: } }
  validate :rules_are_well_formed
  validate :lists_are_well_formed
  validate :upload_is_own_pdf, if: -> { upload_id.present? && will_save_change_to_upload_id? }
  after_destroy_commit -> { ShowcaseSuggestion.where(target_type: "resume", target_id: id).delete_all }

  def rule_set = ShowcaseRules.new(rules, dims: DIMS, sorts: SORTS)
  def pinned?(entry) = Array(pinned_entry_ids).include?(entry.id)
  def excluded?(entry) = Array(excluded_entry_ids).include?(entry.id)

  def member?(entry) = !excluded?(entry) && (pinned?(entry) || rule_set.match?(entry.facets, entry.year))

  # [[entry, "pinned" | "rule"], ...] from the person's record (pass `entries` to share one load).
  def members(entries = user.career_entries.to_a)
    set = rule_set
    chosen = entries.filter_map do |entry|
      next if excluded?(entry)
      if pinned?(entry) then [entry, "pinned"]
      elsif set.match?(entry.facets, entry.year) then [entry, "rule"]
      end
    end
    if set.sort == "manual"
      rank = Array(entry_order).each_with_index.to_h
      chosen.sort_by { |entry, _| [rank.fetch(entry.id, rank.length), entry.position, entry.id] }
    else
      chosen.sort_by { |entry, _| [-(entry.start_on || Date.new(entry.year || 1900)).jd, entry.position, entry.id] }
    end
  end

  # [{kind:, entries: [...]}, ...] in section order; empty sections are left out.
  def sections(members)
    order = (Array(section_order) & CareerEntry::KINDS.keys) | DEFAULT_SECTION_ORDER
    grouped = members.group_by { |entry, _| entry.kind }
    order.filter_map do |kind|
      next unless grouped[kind]
      { kind:, entries: grouped[kind].map { |entry, source| entry.api_json.merge(source:) } }
    end
  end

  def master = ShowcaseMaster.user(user).slice(*INHERITED)
  def effective(master = self.master) = INHERITED.index_with { |field| self[field].nil? ? master[field] : self[field] }
  def overridden = INHERITED.reject { self[_1].nil? }

  def pdf_json = upload && { id: upload.id, url: upload.public_url, filename: upload.filename, byteSize: upload.byte_size }

  def make_default!
    Resume.where(user_id:, is_default: true).where.not(id:).update_all(is_default: false, updated_at: Time.current)
    update!(is_default: true)
  end

  # `members`: the computed entries (from #members) to include as sections; omitted in lists.
  def api_json(members: nil)
    master = self.master
    json = {
      id:, title:, targetRole: target_role, **effective(master).transform_keys(&:to_sym), overridden:, master:,
      rules:, pinnedEntryIds: pinned_entry_ids, excludedEntryIds: excluded_entry_ids, entryOrder: entry_order,
      sectionOrder: section_order, pdf: pdf_json, isDefault: is_default, createdAt: created_at, updatedAt: updated_at
    }
    members ? json.merge(entryCount: members.length, sections: sections(members)) : json
  end

  private

  def rules_are_well_formed
    rule_set.errors.each { errors.add(:rules, _1) }
  end

  def lists_are_well_formed
    { pinned_entry_ids:, excluded_entry_ids:, entry_order: }.each do |field, list|
      valid = list.is_a?(Array) && list.length <= MAX_LISTED_IDS && list.all? { _1.is_a?(String) && _1.length <= 64 }
      errors.add(field, "must be a list of up to #{MAX_LISTED_IDS} entry ids") unless valid
    end
    unless section_order.is_a?(Array) && (section_order - CareerEntry::KINDS.keys).empty?
      errors.add(:section_order, "must list sections from: #{CareerEntry::KINDS.keys.join(', ')}")
    end
  end

  def upload_is_own_pdf
    valid = upload && upload.user_id == user_id && upload.complete? && upload.content_type == "application/pdf"
    errors.add(:upload_id, "must be one of your own completed PDF uploads") unless valid
  end
end
