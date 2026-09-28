module Admin
  class VerificationsController < BaseController
    include AdminPagination

    def index
      rows, meta = admin_paginate(VerificationRequest.includes(user: :profile).order(created_at: :desc), default_per: 100)
      render json: {
        requests: rows.map { _1.attributes.merge(name: _1.user.name, email: _1.user.email, role: _1.user.role, companyName: _1.user.profile&.company_name) }
      }.merge(meta)
    end
    def update
      return render_error("Invalid verification status.", :bad_request) unless %w[approved rejected].include?(params[:status])
      request_record = VerificationRequest.find(params[:id])
      request_record.transaction do
        request_record.update!(status: params[:status], reviewed_by_id: current_user.id, reviewed_at: Time.current)
        profile = request_record.user.profile
        if params[:status] == "approved"
          profile&.update!(verified: true)
        elsif profile&.verified? && !request_record.user.verification_requests.where(status: "approved").where.not(id: request_record.id).exists?
          # Rejecting a previously approved request must not leave the badge behind.
          profile.update!(verified: false)
        end
        audit!("admin.verification.status", request_record, status: request_record.status)
      end
      Notification.create!(user: request_record.user, kind: "verification", title: "Verification update", body: "Your verification request was #{params[:status]}.")
      render json: { ok: true }
    end
  end
end
