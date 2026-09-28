require "test_helper"

class AiBatchSubmitJobTest < ActiveSupport::TestCase
  class FakeBatchClient
    attr_reader :submitted_requests

    def initialize(status: "ended")
      @status = status
      @submitted_requests = []
    end

    def submit(requests)
      @submitted_requests = requests
      "batch_123"
    end

    def status(_batch_id) = { status: @status, results_url: "https://batches.example/batch_123/results" }

    def results(_url)
      @submitted_requests.map do |r|
        { "custom_id" => r.fetch(:custom_id), "result" => { "message" => { "content" => [{ "type" => "text",
          "text" => { tags: ["mixing"], roles: [], genres: [], instruments: [], suggestedPortfolioIds: [], reasons: [] }.to_json }] } } }
      end
    end
  end

  setup do
    @row = AiBatchClassification.create!(portfolio_item_id: "pi_1", account_type: "user", account_id: "usr_1",
      input_context: { title: "Live set recording", tags: [], portfolios: [] })
  end

  test "submits queued rows as one batch and marks them submitted" do
    client = FakeBatchClient.new(status: "in_progress")
    result = AiBatchSubmitJob.new.perform(client:)
    assert_equal 1, result[:submitted]
    assert_equal "submitted", @row.reload.status
    assert_equal "batch_123", @row.batch_id
    assert_equal 1, client.submitted_requests.size
  end

  test "ingests a finished batch's results into each row" do
    @row.update!(status: "submitted", batch_id: "batch_123")
    client = FakeBatchClient.new(status: "ended")
    client.submitted_requests.replace([{ custom_id: @row.id }])

    result = AiBatchSubmitJob.new.perform(client:)
    assert_equal 1, result[:ingested]
    @row.reload
    assert_equal "completed", @row.status
    assert_equal ["mixing"], @row.result["tags"]
    assert_not_nil @row.completed_at
  end

  test "does not ingest a batch that is still in progress" do
    @row.update!(status: "submitted", batch_id: "batch_123")
    client = FakeBatchClient.new(status: "in_progress")
    result = AiBatchSubmitJob.new.perform(client:)
    assert_equal 0, result[:ingested]
    assert_equal "submitted", @row.reload.status
  end
end
