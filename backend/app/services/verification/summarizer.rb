module Verification
  # A three-line, factual summary of a request's evidence for the admin queue. Uses the
  # `verification_summary` AI task (Haiku) when AI is on, allowed and inside its monthly budget;
  # otherwise (or on any AI error) a deterministic template built from the same breakdown.
  # The model only ever sees the plain facts in the breakdown, at most 2,000 characters, never
  # raw page HTML.
  class Summarizer
    TASK = "verification_summary".freeze
    FACTS_LIMIT = 2_000

    def self.call(request) = new(request).call

    def initialize(request, client: nil)
      @request = request
      @client = client
    end

    def call
      text = ai_summary || template
      @request.update!(summary: text)
      text
    end

    def facts_text
      breakdown = @request.evidence_breakdown
      facts = breakdown.fetch("facts", {})
      lines = ["Evidence score: #{breakdown['total']}/100"]
      lines << "Identity: #{identity_phrase(facts)}"
      evidence = facts["evidence"]
      lines << "Evidence link (#{evidence['provider']}): title #{evidence['title'].inspect}, author #{evidence['author'].inspect}" if evidence.present?
      channel = facts["channel"]
      lines << "Proven channel: #{channel.map { |k, v| "#{k} #{v}" }.join(', ')}" if channel.present?
      lines << "Portfolio providers: #{facts['portfolio_providers'].join(', ')}" if facts["portfolio_providers"].present?
      lines << "Vouches from verified musicians: #{facts['vouchers'].presence&.join(', ') || 'none'}"
      lines << "Completed fills/bookings on Verse: #{facts['completed'].to_i}; reviews received: #{facts['reviews'].to_i}"
      lines << "Flags: #{@request.flags.join(', ')}" if @request.flags.present?
      lines.join("\n").first(FACTS_LIMIT)
    end

    private

    def ai_summary
      return nil unless AiAssist.enabled? && AiPricing.task_enabled?(TASK)

      AiSpendGuard.check_task!(TASK)
      result = AiAssist.new(client: @client).suggest(task: TASK, context: { "facts" => facts_text })
      text = result[:suggestion].to_s.lines.map(&:strip).reject(&:blank?).first(3).join("\n")
      return nil if text.blank?

      record_spend(result)
      text
    rescue AiAssist::Error, AiSpendGuard::Paused
      nil
    end

    # System-initiated spend is written to the ledger (no credits: delta 0) so the task's
    # monthly budget and the global hard budget both see it.
    def record_spend(result)
      AiCreditLedger.create!(
        account_type: "user", account_id: @request.user_id, delta: 0, reason: "usage", task: TASK,
        period: AiCredits.current_period, tokens_in: result[:inputTokens], tokens_out: result[:outputTokens],
        cost_inr: AiPricing.estimate_cost_inr(input_tokens: result[:inputTokens], output_tokens: result[:outputTokens]),
        metadata: { "tier" => "admin", "source" => "system" }
      )
    end

    # Three lines from the breakdown alone.
    def template
      breakdown = @request.evidence_breakdown
      facts = breakdown.fetch("facts", {})
      [
        "Score #{breakdown['total'] || @request.evidence_score}/100. Identity: #{identity_phrase(facts)}.",
        "Work: #{work_phrase(facts)}.",
        "On Verse: #{community_phrase(facts)}.#{flags_phrase}"
      ].join("\n")
    end

    def identity_phrase(facts)
      parts = []
      parts << "phone verified" if facts["phone_verified"]
      parts << "Google sign-in verified" if facts["google_verified"]
      parts << "name matches a linked account" if facts["name_match"]
      parts.presence&.join(", ") || "nothing proven yet"
    end

    def work_phrase(facts)
      parts = []
      channel = facts["channel"]
      parts << "#{channel['provider']} channel#{" '#{channel['name']}'" if channel['name']}#{" (#{channel['videos']} items)" if channel['videos']}" if channel.present?
      evidence = facts["evidence"]
      if evidence.present?
        parts << "evidence link on #{evidence['provider']}#{" '#{evidence['title']}'" if evidence['title']}#{" by #{evidence['author']}" if evidence['author']}"
      end
      parts << "portfolio on #{facts['portfolio_providers'].join(', ')}" if facts["portfolio_providers"].present?
      parts.presence&.join("; ") || "no linked work found"
    end

    def community_phrase(facts)
      parts = []
      parts << "#{facts['vouchers'].size} vouch#{'es' unless facts['vouchers'].size == 1} from verified #{facts['vouchers'].join(', ')}" if facts["vouchers"].present?
      parts << "#{facts['completed']} completed fill/booking#{'s' unless facts['completed'].to_i == 1}" if facts["completed"].to_i.positive?
      parts << "#{facts['reviews']} review#{'s' unless facts['reviews'].to_i == 1}" if facts["reviews"].to_i.positive?
      parts.presence&.join("; ") || "no vouches, fills or reviews yet"
    end

    def flags_phrase = @request.flags.present? ? " Flags: #{@request.flags.join(', ')}." : ""
  end
end
