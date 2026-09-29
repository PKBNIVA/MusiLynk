module Verification
  # The three ways a verification request changes state, shared by the admin controller and the
  # automatic path so both do exactly the same thing to the profile, the vouch and the person.
  module Decision
    module_function

    # Approves: status, checks, the profile badge, the vouch promotion and the notification.
    # `reviewer` is nil for an automatic approval.
    def approve!(request, checks:, reviewer: nil)
      request.transaction do
        request.update!(status: "approved", reviewed_by_id: reviewer&.id, reviewed_at: Time.current, checks:)
        request.user.profile&.update!(verified: true)
        # If this user was vouched for and has since joined, their voucher's slot graduates.
        Vouch.where(vouchee_id: request.user_id, status: "joined").update_all(status: "verified", updated_at: Time.current)
      end
      Notifier.verification_approved(request.user)
    end

    # Rejects (or revokes an approval): never leaves the badge behind unless another request is approved.
    def reject!(request, reviewer:, reason: nil, notice: "Your verification request was rejected.")
      request.transaction do
        request.update!(status: "rejected", reviewed_by_id: reviewer.id, reviewed_at: Time.current)
        profile = request.user.profile
        if profile&.verified? && !request.user.verification_requests.where(status: "approved").where.not(id: request.id).exists?
          profile.update!(verified: false)
        end
      end
      notify(request, reason.present? ? "#{notice} Reason: #{reason}" : notice)
    end

    def revoke!(request, reviewer:)
      reject!(request, reviewer:, notice: "Your verification was revoked after a review. You can request verification again with more proof.")
    end

    def notify(request, body)
      Notification.create!(user: request.user, kind: "verification", title: "Verification update", body:)
    end
  end
end
