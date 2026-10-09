# The career record: one master list of a person's experience, credits, education, skills, gear,
# languages, links and awards. Every resume is a view over it, so an entry is edited once here.
class CareerEntriesController < ApplicationController
  include UserRateLimit
  include ScalarParams

  CREATES_PER_HOUR = RateLimits.limit("career-entry-create")
  DATE_FORMAT = /\A(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?\z/

  before_action -> { authenticate!("jobseeker", "employer") }

  def index
    return unless require_scalar_params!(:kind)
    entries = current_user.career_entries.order(:kind, :position, start_on: :desc, created_at: :asc)
    entries = entries.where(kind: params[:kind]) if params[:kind].present?
    render json: { entries: entries.map(&:api_json), kinds: CareerEntry::KINDS.transform_values(&:keys), limit: CareerEntry::MAX_PER_USER }
  end

  def create
    return unless require_scalar_params!(:kind, :startOn, :endOn, :position)
    return unless within_user_rate_limit?("career-entry-create")
    entry = current_user.career_entries.build(kind: params[:kind].to_s)
    return unless assign_fields(entry)
    CareerEntry.transaction do
      current_user.lock!
      if current_user.career_entries.count >= CareerEntry::MAX_PER_USER
        render_error("Your career record can hold up to #{CareerEntry::MAX_PER_USER} entries.", :unprocessable_content, "LIMIT_REACHED")
        raise ActiveRecord::Rollback
      end
      # New entries go last in their section unless a position was given.
      entry.position = (current_user.career_entries.where(kind: entry.kind).maximum(:position) || -1) + 1 unless params.key?(:position)
      entry.save!
    end
    return if performed?

    audit!("career_entry.create", entry, kind: entry.kind)
    render json: { id: entry.id, entry: entry.api_json }, status: :created
  end

  def update
    return unless require_scalar_params!(:kind, :startOn, :endOn, :position)
    entry = current_user.career_entries.find(params[:id])
    return render_error("An entry's kind cannot change. Add a new entry instead.", :unprocessable_content, "KIND_FIXED") if params[:kind].present? && params[:kind] != entry.kind
    return unless assign_fields(entry)
    entry.save!
    audit!("career_entry.update", entry, changed: entry.previous_changes.keys - %w[updated_at])
    render json: { entry: entry.api_json }
  end

  def destroy
    entry = current_user.career_entries.find(params[:id])
    entry.destroy!
    audit!("career_entry.destroy", entry, kind: entry.kind)
    render json: { ok: true }
  end

  private

  # Returns false after rendering 422 for an unreadable date.
  def assign_fields(entry)
    entry.fields = json_param(:fields) || {} if params.key?(:fields)
    entry.tags = json_param(:tags) || [] if params.key?(:tags)
    entry.position = params[:position] if params.key?(:position)
    { startOn: :start_on, endOn: :end_on }.each do |param, column|
      next unless params.key?(param)
      date = parse_date(params[param])
      if date == false
        render_error("#{param} must be a date like 2024, 2024-06 or 2024-06-15.", :unprocessable_content, "INVALID_DATE", fields: { param => ["must be a date like 2024, 2024-06 or 2024-06-15"] })
        return false
      end
      entry.public_send(:"#{column}=", date)
    end
    true
  end

  # nil for blank, false when unreadable; a year or month is stored as its first day.
  def parse_date(value)
    return nil if value.blank?
    year, month, day = value.to_s.match(DATE_FORMAT)&.captures
    return false unless year
    Date.new(year.to_i, (month || 1).to_i, (day || 1).to_i)
  rescue Date::Error
    false
  end
end
