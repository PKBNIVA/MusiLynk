module Verification
  # Scores a pending request and acts on it. Strong evidence with proven identity is approved
  # automatically (like the admin path); everything else stays pending for a human. It never
  # rejects. Safe to call repeatedly (rescore): a musician is told to add more proof only once,
  # and the summary is regenerated only when the score changes.
  class Evaluate
    STEPS = {
      "phone" => "verify your phone number",
      "google" => "sign in with Google",
      "channel" => "connect a YouTube channel or Instagram business account in your name",
      "vouch" => "ask a verified musician to vouch for you"
    }.freeze

    # Stubbed in tests: true for `percent` percent of calls.
    def self.sample?(percent) = SecureRandom.random_number(100.0) < percent.to_f

    def self.call(request) = new(request).call

    def initialize(request)
      @request = request
    end

    def call
      return @request unless @request.status == "pending"

      previous_score = @request.evidence_score
      result = Evidence.call(@request)
      if auto_approvable?(result)
        auto_approve!
      else
        stay_pending!(result, previous_score)
      end
      @request
    end

    private

    def auto_approvable?(result)
      config = Config.auto_approve
      return false unless config.fetch(:enabled) && @request.kind == "professional"
      return false unless result.flags.empty? && result.score >= config.fetch(:min_score)

      !config.fetch(:require_identity) || result.breakdown.dig("identity", "score") >= config.fetch(:identity_min)
    end

    def auto_approve!
      Decision.approve!(@request, checks: %w[identity work_links])
      sampled = self.class.sample?(Config.auto_approve.fetch(:audit_sample_percent))
      @request.update!(auto_decision: "auto_approved", audit_sample: sampled)
      AuditLog.create!(action: "verification.auto_approve", entity_type: "VerificationRequest", entity_id: @request.id,
        metadata: { score: @request.evidence_score, auditSample: sampled })
      Summarizer.call(@request) if sampled
    end

    def stay_pending!(result, previous_score)
      if result.score < Config.summary_min_score
        first_time = @request.auto_decision != "needs_more_proof"
        @request.update!(auto_decision: "needs_more_proof", summary: nil)
        request_more_proof if first_time && @request.kind == "professional"
      else
        @request.update!(auto_decision: nil) if @request.auto_decision == "needs_more_proof"
        Summarizer.call(@request) if @request.summary.blank? || previous_score != result.score
      end
    end

    def request_more_proof
      parts = @request.evidence_breakdown.fetch("identity").fetch("parts")
      links = @request.evidence_breakdown.fetch("links").fetch("parts")
      community = @request.evidence_breakdown.fetch("community").fetch("parts")
      missing = []
      missing << STEPS.fetch("phone") if parts["phone"].to_i.zero?
      missing << STEPS.fetch("google") if parts["google"].to_i.zero?
      missing << STEPS.fetch("channel") if links["proven_channel"].to_i.zero?
      missing << STEPS.fetch("vouch") if community["vouch"].to_i.zero?
      Notifier.verification_needs_more_proof(@request.user, missing)
    end
  end
end
