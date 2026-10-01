module Admin
  class JobsController < BaseController
    include AdminPagination

    STATUSES = %w[pending published rejected closed].freeze

    # GET /api/admin/jobs?status=pending|published|rejected|closed (blank or "all" lists every
    # status). The filter runs before paging so `total` counts exactly the rows being paged.
    def index
      scope = Job.with_applications_count.with_posted_as.includes(employer: :profile).order(created_at: :desc)
      status = params[:status].to_s
      return render_error("Invalid opportunity status.", :bad_request) unless status.blank? || status == "all" || STATUSES.include?(status)

      scope = scope.where(status:) if STATUSES.include?(status)
      rows, meta = admin_paginate(scope, default_per: 100)
      render json: { jobs: rows.map { _1.api_json(current_user) } }.merge(meta)
    end

    def update
      return render_error("Invalid opportunity status.", :bad_request) unless STATUSES.include?(params[:status])
      job = Job.find(params[:id])
      job.update!(status: params[:status], moderation_note: params.key?(:note) ? params[:note].to_s.strip.first(2_000).presence : job.moderation_note, published_at: params[:status] == "published" ? (job.published_at || Time.current) : job.published_at)
      Notification.create!(user: job.employer, kind: "moderation", title: "Opportunity review update", body: "#{job.title}: #{job.status}", link: "/employer")
      audit!("admin.job.status", job, status: job.status)
      render json: { ok: true }
    end
  end
end
