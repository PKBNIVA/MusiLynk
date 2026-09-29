module Admin
  class VerificationsController < BaseController
    include AdminPagination

    def index
      # Vouched applicants (users.vouched_by_id present) are sorted first, oldest first within
      # each group, so the admin sees referred musicians before the rest of the queue.
      rows, meta = admin_paginate(
        VerificationRequest.includes(user: [:profile, :vouched_by]).order(Arel.sql("(users.vouched_by_id IS NULL) ASC, verification_requests.created_at DESC")).joins(:user),
        default_per: 100
      )
      render json: {
        requests: rows.map { |r|
          r.attributes.merge(name: r.user.name, email: r.user.email, role: r.user.role, companyName: r.user.profile&.company_name,
            vouchedByName: r.user.vouched_by&.name)
        }
      }.merge(meta)
    end

    def update
      return render_error("Invalid verification status.", :bad_request) unless %w[approved rejected].include?(params[:status])
      request_record = VerificationRequest.find(params[:id])
      checks = Array(params[:checks]).map(&:to_s) & VerificationRequest::CHECKS
      if params[:status] == "approved" && checks.empty?
        return render_error("Choose at least one check.", :unprocessable_content, "CHECKS_REQUIRED")
      end
      request_record.transaction do
        attrs = { status: params[:status], reviewed_by_id: current_user.id, reviewed_at: Time.current }
        attrs[:checks] = checks if params[:status] == "approved"
        request_record.update!(attrs)
        profile = request_record.user.profile
        if params[:status] == "approved"
          profile&.update!(verified: true)
          # If this user was vouched for and has since joined, their voucher's slot graduates.
          Vouch.where(vouchee_id: request_record.user_id, status: "joined").update_all(status: "verified", updated_at: Time.current)
        elsif profile&.verified? && !request_record.user.verification_requests.where(status: "approved").where.not(id: request_record.id).exists?
          # Rejecting a previously approved request must not leave the badge behind.
          profile.update!(verified: false)
        end
        audit!("admin.verification.status", request_record, status: request_record.status, checks: request_record.checks)
      end
      Notification.create!(user: request_record.user, kind: "verification", title: "Verification update", body: "Your verification request was #{params[:status]}.")
      render json: { ok: true }
    end
  end
end
