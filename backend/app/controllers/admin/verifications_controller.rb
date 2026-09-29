module Admin
  class VerificationsController < BaseController
    include AdminPagination

    REASON_LIMIT = 2_000

    def index
      # Vouched applicants (users.vouched_by_id present) come first, then the strongest evidence
      # (score desc), newest first within a score.
      rows, meta = admin_paginate(
        VerificationRequest.includes(user: [:profile, :vouched_by]).joins(:user)
          .order(Arel.sql("(users.vouched_by_id IS NULL) ASC, verification_requests.evidence_score DESC NULLS LAST, verification_requests.created_at DESC")),
        default_per: 100
      )
      render json: {
        requests: rows.map { |r|
          r.attributes.merge(name: r.user.name, email: r.user.email, role: r.user.role, companyName: r.user.profile&.company_name,
            vouchedByName: r.user.vouched_by&.name)
        }
      }.merge(meta)
    end

    # GET /api/admin/verifications/stats: how much the automation is deciding, for the tab header.
    def stats
      render json: { days7: window_stats(7), days30: window_stats(30) }
    end

    def update
      return render_error("Invalid verification status.", :bad_request) unless %w[approved rejected].include?(params[:status])
      request_record = VerificationRequest.find(params[:id])
      checks = Array(params[:checks]).map(&:to_s) & VerificationRequest::CHECKS
      if params[:status] == "approved" && checks.empty?
        return render_error("Choose at least one check.", :unprocessable_content, "CHECKS_REQUIRED")
      end
      if params[:status] == "approved"
        Verification::Decision.approve!(request_record, checks:, reviewer: current_user)
      else
        Verification::Decision.reject!(request_record, reviewer: current_user, reason: params[:reason].to_s.strip.first(REASON_LIMIT).presence)
      end
      audit!("admin.verification.status", request_record, status: request_record.status, checks: request_record.checks)
      render json: { ok: true }
    end

    # POST /api/admin/verifications/:id/revoke: takes back an approval (typically an automatic one).
    def revoke
      request_record = VerificationRequest.find(params[:id])
      return render_error("Only an approved verification can be revoked.", :unprocessable_content, "NOT_APPROVED") unless request_record.status == "approved"

      Verification::Decision.revoke!(request_record, reviewer: current_user)
      audit!("admin.verification.revoke", request_record, status: request_record.status, autoDecision: request_record.auto_decision)
      render json: { ok: true }
    end

    private

    def window_stats(days)
      scope = VerificationRequest.where(created_at: days.days.ago..)
      total = scope.count
      auto = scope.where(auto_decision: "auto_approved").count
      { total:, autoApproved: auto, autoApprovalRate: total.zero? ? 0 : (auto * 100.0 / total).round(1),
        auditSample: scope.where(audit_sample: true).count }
    end
  end
end
