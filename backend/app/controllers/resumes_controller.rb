# Resumes: many per person, each a view over their one career record (see Resume). Always
# personal: the acting-as header is ignored here.
class ResumesController < ApplicationController
  include UserRateLimit
  include ScalarParams

  CREATES_PER_HOUR = RateLimits.limit("resume-create")
  PLAIN_FIELDS = { title: :title, targetRole: :target_role }.freeze
  # Sent as null (or "") to go back to inheriting the profile.
  OVERRIDE_TEXT = %w[headline summary].freeze
  ID_LISTS = { pinnedEntryIds: :pinned_entry_ids, excludedEntryIds: :excluded_entry_ids, entryOrder: :entry_order }.freeze
  ENTRY_STATES = %w[pinned excluded auto].freeze

  before_action -> { authenticate!("jobseeker", "employer") }

  def index
    resumes = current_user.resumes.includes(:upload).order(is_default: :desc, updated_at: :desc, id: :asc).to_a
    entries = resumes.any? ? current_user.career_entries.to_a : []
    render json: {
      resumes: resumes.map do |resume|
        members = resume.members(entries)
        resume.api_json.merge(entryCount: members.length)
      end,
      limit: Resume::MAX_PER_USER
    }
  end

  def show
    render json: { resume: full_json(owned_resume) }
  end

  def create
    return unless require_scalar_params!(*PLAIN_FIELDS.keys, *OVERRIDE_TEXT, :uploadId, :isDefault)
    return unless within_user_rate_limit?("resume-create")
    resume = current_user.resumes.build
    return unless assign_fields(resume)
    Resume.transaction do
      # Serialises creates for one person so the cap cannot be raced past.
      current_user.lock!
      existing = current_user.resumes.count
      if existing >= Resume::MAX_PER_USER
        render_error("You can have up to #{Resume::MAX_PER_USER} resumes. Delete one to add another.", :unprocessable_content, "LIMIT_REACHED")
        raise ActiveRecord::Rollback
      end
      resume.save!
      resume.make_default! if existing.zero? || truthy?(params[:isDefault])
    end
    return if performed?

    audit!("resume.create", resume)
    render json: { id: resume.id, resume: full_json(resume) }, status: :created
  end

  def update
    return unless require_scalar_params!(*PLAIN_FIELDS.keys, *OVERRIDE_TEXT, :uploadId, :isDefault)
    resume = owned_resume
    return unless assign_fields(resume)
    Resume.transaction do
      resume.save!
      resume.make_default! if truthy?(params[:isDefault]) && !resume.is_default
    end
    audit!("resume.update", resume, changed: resume.previous_changes.keys - %w[updated_at])
    render json: { resume: full_json(resume) }
  end

  # POST /api/resumes/:id/reset {fields: ["headline", "summary"]}: inherit the profile again.
  def reset
    resume = owned_resume
    fields = params.key?(:fields) ? string_list_param(:fields) : Resume::INHERITED
    unless fields && (fields - Resume::INHERITED).empty?
      return render_error("fields must be a list from: #{Resume::INHERITED.join(', ')}.", :unprocessable_content, "INVALID_FIELDS")
    end
    resume.update!(fields.index_with(nil))
    audit!("resume.reset", resume, fields:)
    render json: { resume: full_json(resume) }
  end

  # PUT /api/resumes/:id/entries/:entryId {state}: "pinned", "excluded" or "auto" (rules decide).
  def set_entry
    return unless require_scalar_params!(:state)
    resume = owned_resume
    state = params[:state].to_s
    return render_error("state must be one of: #{ENTRY_STATES.join(', ')}.", :unprocessable_content, "INVALID_STATE") unless ENTRY_STATES.include?(state)
    entry = current_user.career_entries.find(params[:entryId].to_s)
    Resume.transaction do
      resume.lock!
      resume.pinned_entry_ids = Array(resume.pinned_entry_ids) - [entry.id] + (state == "pinned" ? [entry.id] : [])
      resume.excluded_entry_ids = Array(resume.excluded_entry_ids) - [entry.id] + (state == "excluded" ? [entry.id] : [])
      resume.save!
    end
    audit!("resume.entry", resume, entryId: entry.id, state:)
    render json: { resume: full_json(resume) }
  end

  def destroy
    resume = owned_resume
    Resume.transaction do
      resume.destroy!
      # A person keeps a default while they have any resume: the most recently updated one.
      if resume.is_default && (successor = current_user.resumes.order(updated_at: :desc, id: :asc).first)
        successor.make_default!
      end
    end
    audit!("resume.destroy", resume, title: resume.title)
    render json: { ok: true }
  end

  def make_default
    resume = owned_resume
    Resume.transaction { resume.make_default! }
    audit!("resume.default", resume)
    render json: { resume: full_json(resume) }
  end

  private

  def owned_resume = current_user.resumes.includes(:upload).find(params[:id])

  def full_json(resume) = resume.api_json(members: resume.members(current_user.career_entries.to_a))

  # Returns false after rendering 422 when an id list is malformed or names another person's entry.
  def assign_fields(resume)
    PLAIN_FIELDS.each { |param, column| resume.public_send(:"#{column}=", params[param]) if params.key?(param) }
    OVERRIDE_TEXT.each { |field| resume.public_send(:"#{field}=", params[field].presence) if params.key?(field) }
    resume.rules = json_param(:rules) || {} if params.key?(:rules)
    resume.section_order = json_param(:sectionOrder) || [] if params.key?(:sectionOrder)
    # uploadId: null (or "") detaches the PDF.
    resume.upload_id = params[:uploadId].presence if params.key?(:uploadId)
    lists = ID_LISTS.keys.select { params.key?(_1) }
    return true if lists.empty?

    own = current_user.career_entries.pluck(:id)
    lists.each do |key|
      ids = params[key].nil? ? [] : string_list_param(key, max: Resume::MAX_LISTED_IDS)
      unless ids && (ids - own).empty?
        render_error("#{key} must list entries from your career record.", :unprocessable_content, "INVALID_ENTRY", fields: { key => ["must list entries from your career record"] })
        return false
      end
      resume.public_send(:"#{ID_LISTS[key]}=", ids)
    end
    true
  end

  def truthy?(value) = [true, "true", "1", 1].include?(value)
end
