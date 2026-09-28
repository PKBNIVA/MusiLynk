require "test_helper"
require "minitest/mock"

class AiControllerTest < ActionDispatch::IntegrationTest
  PASSWORD = "StrongPass123!".freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @jobseeker = User.create!(name: "AI Jobseeker", email: "ai-jobseeker@example.com", password: PASSWORD, role: "jobseeker", status: "active")
    @employer = User.create!(name: "AI Employer", email: "ai-employer@example.com", password: PASSWORD, role: "employer", status: "active")
    @token = session_for(@jobseeker)
    @employer_token = session_for(@employer)
  end

  teardown { Rails.cache = @original_cache }

  test "status reports disabled with no key configured" do
    with_env("ANTHROPIC_API_KEY" => nil) do
      get "/api/ai/status"
      assert_response :success
      body = response.parsed_body
      assert_equal false, body.fetch("enabled")
      assert_includes body.fetch("tasks"), "post_caption"
      assert_not_includes body.fetch("tasks"), "autocomplete"
    end
  end

  test "status reports enabled when a key is present" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      get "/api/ai/status"
      assert_response :success
      assert_equal true, response.parsed_body.fetch("enabled")
    end
  end

  test "suggest requires authentication" do
    post "/api/ai/suggest", params: { task: "post_caption", context: { kind: "release" } }, as: :json
    assert_response :unauthorized
  end

  test "suggest answers 503 AI_DISABLED with no key configured" do
    with_env("ANTHROPIC_API_KEY" => nil) do
      post "/api/ai/suggest", params: { task: "post_caption", context: { kind: "release" } }, headers: bearer(@token), as: :json
      assert_response :service_unavailable
      assert_equal "AI_DISABLED", response.parsed_body["code"]
    end
  end

  test "suggest rejects an unknown task" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      post "/api/ai/suggest", params: { task: "not_a_real_task", context: {} }, headers: bearer(@token), as: :json
      assert_response :unprocessable_content
      assert_equal "UNKNOWN_TASK", response.parsed_body["code"]
    end
  end

  test "suggest returns a suggestion on success and never exposes the task through /suggest for the internal autocomplete task" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      stub_anthropic_success("Big news: our new single drops Friday!") do
        post "/api/ai/suggest", params: { task: "post_caption", context: { kind: "release", notes: "new single" } }, headers: bearer(@token), as: :json
      end
      assert_response :success
      body = response.parsed_body
      assert_equal "Big news: our new single drops Friday!", body.fetch("suggestion")
      assert_equal "post_caption", body.fetch("task")

      post "/api/ai/suggest", params: { task: "autocomplete", context: { field: "cities", query: "mu" } }, headers: bearer(@token), as: :json
      assert_response :unprocessable_content
      assert_equal "UNKNOWN_TASK", response.parsed_body["code"]
    end
  end

  test "suggest enforces the per-user hourly rate limit" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      stub_anthropic_success("ok") do
        AiController::SUGGEST_LIMIT_PER_HOUR.times do
          post "/api/ai/suggest", params: { task: "post_caption", context: { kind: "release" } }, headers: bearer(@token), as: :json
          assert_response :success
        end
        post "/api/ai/suggest", params: { task: "post_caption", context: { kind: "release" } }, headers: bearer(@token), as: :json
      end
      assert_response :too_many_requests
      assert_equal "RATE_LIMITED", response.parsed_body["code"]
    end
  end

  test "suggest answers 429 AI_BUDGET_EXHAUSTED once the global daily cap is spent" do
    with_env("ANTHROPIC_API_KEY" => "sk-test", "AI_DAILY_REQUEST_CAP" => "1") do
      stub_anthropic_success("ok") do
        post "/api/ai/suggest", params: { task: "post_caption", context: { kind: "release" } }, headers: bearer(@token), as: :json
        assert_response :success
        post "/api/ai/suggest", params: { task: "post_caption", context: { kind: "release" } }, headers: bearer(@employer_token), as: :json
      end
      assert_response :too_many_requests
      assert_equal "AI_BUDGET_EXHAUSTED", response.parsed_body["code"]
    end
  end

  test "message_reply is refused for a conversation the caller does not belong to" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      other_candidate = User.create!(name: "Other Candidate", email: "ai-other-candidate@example.com", password: PASSWORD, role: "jobseeker", status: "active")
      other_employer = User.create!(name: "Other Employer", email: "ai-other-employer@example.com", password: PASSWORD, role: "employer", status: "active")
      conversation = Conversation.create!(candidate: other_candidate, employer: other_employer)

      post "/api/ai/suggest", params: { task: "message_reply", context: { conversationId: conversation.id } }, headers: bearer(@token), as: :json
      assert_response :forbidden
      assert_equal "AI_ACCESS_DENIED", response.parsed_body["code"]
    end
  end

  test "message_reply fetches the last messages for a conversation the caller belongs to" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      conversation = Conversation.create!(candidate: @jobseeker, employer: @employer)
      conversation.messages.create!(sender: @employer, body: "Are you free next week?")
      conversation.messages.create!(sender: @jobseeker, body: "Possibly, what dates?")

      stub_anthropic_success("Yes, I'm free on the 14th and 15th.") do
        post "/api/ai/suggest", params: { task: "message_reply", context: { conversationId: conversation.id } }, headers: bearer(@token), as: :json
      end
      assert_response :success
      assert_equal "Yes, I'm free on the 14th and 15th.", response.parsed_body.fetch("suggestion")
    end
  end

  test "job_description is refused for a draft job the caller does not own" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      other_employer = User.create!(name: "Other Employer 2", email: "ai-other-employer-2@example.com", password: PASSWORD, role: "employer", status: "active")
      job = Job.create!(employer: other_employer, title: "Private draft", company: "Other Co", location: "Pune", kind: "Contract", genre: "Pop",
        description: "A private draft not yet published.", status: "draft")

      post "/api/ai/suggest", params: { task: "job_description", context: { jobId: job.id, title: "Private draft" } }, headers: bearer(@employer_token), as: :json
      assert_response :forbidden
      assert_equal "AI_ACCESS_DENIED", response.parsed_body["code"]
    end
  end

  test "a timeout from the upstream call surfaces as a friendly error, not a 500" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      stub_anthropic_raising(Net::ReadTimeout.new) do
        post "/api/ai/suggest", params: { task: "post_caption", context: { kind: "release" } }, headers: bearer(@token), as: :json
      end
      assert_response :bad_gateway
      assert_equal "AI_TIMEOUT", response.parsed_body["code"]
    end
  end

  test "a malformed upstream response surfaces as a friendly error, not a 500" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      stub_anthropic_body("not json") do
        post "/api/ai/suggest", params: { task: "post_caption", context: { kind: "release" } }, headers: bearer(@token), as: :json
      end
      assert_response :bad_gateway
      assert_equal "AI_MALFORMED_RESPONSE", response.parsed_body["code"]
    end
  end

  test "autocomplete works with no AI configured, backed by the taxonomy" do
    with_env("ANTHROPIC_API_KEY" => nil) do
      get "/api/ai/autocomplete", params: { field: "cities", q: "mum" }
      assert_response :success
      body = response.parsed_body
      assert_equal [{ "value" => "Mumbai", "source" => "taxonomy" }], body.fetch("suggestions")
    end
  end

  test "autocomplete rejects an unknown field" do
    get "/api/ai/autocomplete", params: { field: "nope", q: "mum" }
    assert_response :unprocessable_content
    assert_equal "UNKNOWN_FIELD", response.parsed_body["code"]
  end

  test "autocomplete adds AI suggestions only when signed in, AI is enabled and taxonomy matches are thin" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      stub_anthropic_success("Vintage Synth Repair\nField Recording") do
        get "/api/ai/autocomplete", params: { field: "skills", q: "zzz-no-match" }, headers: bearer(@token)
      end
      assert_response :success
      suggestions = response.parsed_body.fetch("suggestions")
      assert(suggestions.any? { _1["source"] == "ai" })
    end
  end

  test "autocomplete never calls AI when signed out, even with fewer than 3 matches" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      get "/api/ai/autocomplete", params: { field: "skills", q: "zzz-no-match" }
      assert_response :success
      assert_empty response.parsed_body.fetch("suggestions")
    end
  end

  private

  def stub_anthropic_success(text, &block)
    stub_anthropic_body({ content: [{ type: "text", text: }], usage: { input_tokens: 1, output_tokens: 1 } }.to_json, &block)
  end

  def stub_anthropic_body(body, &block)
    fake_client = Object.new
    fake_client.define_singleton_method(:post) { |*_args, **_kwargs| [200, body] }
    with_fake_client(fake_client, &block)
  end

  def stub_anthropic_raising(error, &block)
    fake_client = Object.new
    fake_client.define_singleton_method(:post) { |*_args, **_kwargs| raise error }
    with_fake_client(fake_client, &block)
  end

  def with_fake_client(fake_client, &block)
    original_new = AiAssist.method(:new)
    AiAssist.define_singleton_method(:new) { |*_args, **_kwargs| original_new.call(client: fake_client) }
    block.call
  ensure
    AiAssist.singleton_class.send(:remove_method, :new)
  end

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    Session.start!(user, token_digest: Digest::SHA256.hexdigest(raw), user_agent: nil)
    raw
  end

  def bearer(token) = { "Authorization" => "Bearer #{token}" }

  def with_env(values)
    previous = values.keys.to_h { [_1, ENV[_1]] }
    values.each { |key, value| ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| ENV[key] = value }
  end
end
