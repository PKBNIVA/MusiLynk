module Verification
  # Re-scores a pending verification request (Verification::Evaluate). Enqueued when a request
  # is created and whenever something that feeds the score changes: a connection, a vouch, a
  # completed fill/booking or a review (see `.for_user`, called from those models' commit hooks).
  class RescoreJob < ApplicationJob
    queue_as :default

    def perform(request_id)
      request = VerificationRequest.find_by(id: request_id)
      Evaluate.call(request) if request&.status == "pending"
    end

    # Cheap to call from anywhere: one indexed query, and nothing is enqueued for a user with no
    # pending request. Never lets a scoring problem fail the write that triggered it.
    def self.for_user(user_id)
      return if user_id.blank?
      VerificationRequest.where(user_id:, status: "pending").pluck(:id).each { perform_later(_1) }
    rescue StandardError => error
      ErrorReporter.capture(error, tags: { source: "verification_rescore_enqueue" })
    end
  end
end
