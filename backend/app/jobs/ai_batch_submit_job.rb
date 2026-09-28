# Every 30 minutes: submits queued classify_portfolio_item rows as one Message Batch (50%
# cheaper than a synchronous call), and polls previously submitted batches for results.
#
# One run does both halves so a batch that finishes within a poll cycle or two is ingested
# without a separate job. Each ai_batch_classifications row moves queued -> submitted ->
# completed/failed; failures are recorded per row rather than failing the whole batch.
class AiBatchSubmitJob < ApplicationJob
  queue_as :scheduled

  MAX_PER_BATCH = 100

  # Launch-disabled (see config/ai_pricing.yml `launch:`): the good_job.rb cron entry is left out
  # entirely so this never fires on a schedule, but a no-op guard here too means a direct
  # `AiBatchSubmitJob.perform_now` (a console, a stray enqueue) submits nothing new either. Rows
  # already submitted before the task was disabled are still polled and ingested, since that
  # costs nothing further and just finishes work already paid for.
  def self.disabled? = !AiPricing.task_enabled?("classify_portfolio_item")

  def perform(now = Time.current, client: nil)
    @client = client || BatchClient.new
    { submitted: self.class.disabled? ? 0 : submit_queued(now), ingested: ingest_submitted(now) }
  end

  private

  def submit_queued(now)
    rows = AiBatchClassification.queued.order(:created_at).limit(MAX_PER_BATCH).to_a
    return 0 if rows.empty?

    requests = rows.map do |row|
      { custom_id: row.id, model: AiAssist.model_name, system: AiPortfolioItemClassifier::SYSTEM_PROMPT,
        prompt: AiPortfolioItemClassifier.build_prompt(row.input_context.symbolize_keys, portfolios: row.input_context["portfolios"] || []),
        max_tokens: AiAssist.max_tokens_for("classify_portfolio_item") }
    end
    batch_id = @client.submit(requests)
    AiBatchClassification.where(id: rows.map(&:id)).update_all(status: "submitted", batch_id:, submitted_at: now, updated_at: now)
    rows.size
  end

  def ingest_submitted(now)
    batch_ids = AiBatchClassification.submitted.distinct.pluck(:batch_id).compact
    batch_ids.sum { ingest_batch(_1, now) }
  end

  def ingest_batch(batch_id, now)
    info = @client.status(batch_id)
    return 0 unless info[:status] == "ended" && info[:results_url].present?

    results = @client.results(info[:results_url])
    results.count do |entry|
      row = AiBatchClassification.submitted.find_by(id: entry["custom_id"], batch_id:)
      next false unless row

      text = entry.dig("result", "message", "content")&.find { _1["type"] == "text" }&.dig("text")
      begin
        parsed = AiPortfolioItemClassifier.parse(text, portfolios: row.input_context["portfolios"] || [])
        row.update!(status: "completed", result: parsed, completed_at: now)
      rescue AiAssist::Error => e
        row.update!(status: "failed", error: e.message, completed_at: now)
      end
      true
    end
  end
end
