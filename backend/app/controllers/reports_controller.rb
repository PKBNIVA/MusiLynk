class ReportsController < ApplicationController
  include UserRateLimit

  CREATE_LIMIT_PER_HOUR = RateLimits.limit("report")
  FIELD_LIMITS = { entityType: 40, entityId: 120, reason: 200, details: 5_000 }.freeze
  # Kept in step with src/app/components/ReportDialog.tsx REPORT_REASONS.
  REASONS = ["Harassment", "Asks for payment", "Spam or scam", "Unsafe contact request", "Misleading listing", "Other"].freeze
  ENTITY_TYPES = %w[user job act review portfolio resume post comment].freeze

  def create
    return unless authenticate!
    invalid = FIELD_LIMITS.keys.find { |key| params.key?(key) && !params[key].is_a?(String) }
    return render_error("#{invalid} must be text.", :unprocessable_content, "INVALID_REPORT") if invalid
    missing = %i[entityType entityId reason].find { params[_1].blank? }
    return render_error("#{missing} is required.", :unprocessable_content, "INVALID_REPORT") if missing
    too_long = FIELD_LIMITS.find { |key, limit| params[key].to_s.length > limit }&.first
    return render_error("#{too_long} is too long.", :unprocessable_content, "INVALID_REPORT") if too_long

    entity_type = params[:entityType].to_s.downcase
    return render_error("This kind of item cannot be reported.", :unprocessable_content, "INVALID_ENTITY_TYPE") unless ENTITY_TYPES.include?(entity_type)
    return render_error("Choose a reason from the list.", :unprocessable_content, "INVALID_REASON") unless REASONS.include?(params[:reason])
    return render_error("This item could not be found.", :not_found, "ENTITY_NOT_FOUND") unless entity_exists?(entity_type, params[:entityId])
    if entity_type == "user" && params[:entityId].to_s == current_user.id.to_s
      return render_error("You can't report your own account.", :unprocessable_content, "CANNOT_REPORT_SELF")
    end
    return unless within_user_rate_limit?("report")

    if Report.where(reporter_id: current_user.id, entity_type: entity_type, entity_id: params[:entityId], status: "open").exists?
      return render_error("You already have an open report on this. Our moderators will review it.", :conflict, "ALREADY_REPORTED")
    end

    report = Report.create!(reporter: current_user, entity_type: entity_type, entity_id: params[:entityId], reason: params[:reason], details: params[:details], status: "open")
    audit!("report.create", report)
    render json: { id: report.id }, status: :created
  end

  private

  def sent_to_reporter?(column, entity_id)
    Application.joins(:job).where(jobs: { employer_id: current_user.id }).where(column => entity_id).exists?
  end

  def entity_exists?(entity_type, entity_id)
    case entity_type
    when "user" then User.exists?(id: entity_id)
    when "job" then Job.exists?(id: entity_id)
    when "act" then Act.exists?(id: entity_id)
    when "review" then Review.exists?(id: entity_id)
    # Only what the reporter can actually see: a public or link-only portfolio, or a portfolio or
    # resume that was sent with an application to one of the reporter's jobs.
    when "portfolio"
      Portfolio.with_owner.find_by(id: entity_id)&.publicly_readable? || sent_to_reporter?(:portfolio_id, entity_id)
    when "resume" then sent_to_reporter?(:resume_id, entity_id)
    when "post" then Post.exists?(id: entity_id)
    when "comment" then PostComment.exists?(id: entity_id)
    else false
    end
  end
end
