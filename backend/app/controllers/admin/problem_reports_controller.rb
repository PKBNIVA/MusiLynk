module Admin
  # The "Problem reports" tab: what people sent through the in-app "Report a problem" dialog.
  # Admin-only (BaseController). The screenshot is never part of the list or detail payload; it is
  # fetched on request as a short-lived signed link, and each fetch is audit-logged.
  class ProblemReportsController < BaseController
    include AdminPagination

    SCREENSHOT_LINK_TTL = 5.minutes

    def index
      reports = ProblemReport.includes(:user, :handled_by).order(created_at: :desc)
      reports = reports.where(status: params[:status]) if ProblemReport::STATUSES.include?(params[:status].to_s)
      rows, meta = admin_paginate(reports, default_per: 50)
      counts = ProblemReport.group(:status).count
      render json: { reports: rows.map { serialize(_1) }, counts: ProblemReport::STATUSES.index_with { counts.fetch(_1, 0) } }.merge(meta)
    end

    def show
      render json: { report: serialize(ProblemReport.includes(:user, :handled_by).find(params[:id])) }
    end

    # PATCH { status:, adminNote: } — either or both. Status changes and note edits are audit-logged.
    def update
      report = ProblemReport.find(params[:id])
      status = params[:status]
      note = params[:adminNote]
      return render_error("Choose new, triaged or resolved.", :bad_request, "INVALID_STATUS") if params.key?(:status) && !(status.is_a?(String) && ProblemReport::STATUSES.include?(status))
      return render_error("The note must be text.", :unprocessable_content, "INVALID_NOTE") if params.key?(:adminNote) && !(note.nil? || note.is_a?(String))
      return render_error("The note can be at most #{ProblemReport::NOTE_MAX} characters.", :unprocessable_content, "INVALID_NOTE") if note.to_s.length > ProblemReport::NOTE_MAX
      return render_error("Nothing to update.", :bad_request, "NOTHING_TO_UPDATE") unless params.key?(:status) || params.key?(:adminNote)

      previous = report.status
      ProblemReport.transaction do
        report.admin_note = note.to_s.strip.presence if params.key?(:adminNote)
        report.status = status if params.key?(:status)
        note_changed = report.admin_note_changed?
        status_changed = report.status_changed?
        if status_changed || note_changed
          report.handled_by = current_user
          report.handled_at = Time.current
        end
        report.save!
        audit!("admin.problem_report.status", report, from: previous, to: report.status) if status_changed
        audit!("admin.problem_report.note", report, length: report.admin_note.to_s.length) if note_changed
      end
      render json: { ok: true, report: serialize(report.reload) }
    end

    def screenshot
      report = ProblemReport.find(params[:id])
      blob = report.screenshot_blob
      return render_error("This report has no screenshot.", :not_found, "NO_SCREENSHOT") unless blob

      ActiveStorage::Current.url_options = storage_url_options
      url = blob.url(expires_in: SCREENSHOT_LINK_TTL, disposition: "inline", filename: blob.filename)
      audit!("admin.problem_report.screenshot", report)
      response.set_header("Cache-Control", "no-store")
      render json: { url:, contentType: blob.content_type, expiresAt: SCREENSHOT_LINK_TTL.from_now }
    end

    private

    def storage_url_options
      uri = URI.parse(ENV.fetch("API_HOST", request.base_url).to_s.then { _1.include?("://") ? _1 : "https://#{_1}" })
      { protocol: uri.scheme, host: uri.host, port: uri.port == uri.default_port ? nil : uri.port }
    end

    def serialize(report)
      {
        id: report.id, status: report.status, description: report.description, expected: report.expected, page: report.page,
        context: report.context, email: report.email, hasScreenshot: report.screenshot?, adminNote: report.admin_note,
        createdAt: report.created_at, handledAt: report.handled_at, handledByName: report.handled_by&.name,
        user: report.user && { id: report.user.id, name: report.user.name, email: report.user.email, role: report.user.role }
      }
    end
  end
end
