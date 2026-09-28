require "test_helper"
require "minitest/mock"

class AiControllerTest < ActionDispatch::IntegrationTest
  PASSWORD = "StrongPass123!".freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @jobseeker = User.create!(name: "AI Jobseeker", email: "ai-jobseeker@example.com", password: PASSWORD, role: "jobseeker", status: "active", email_verified: true)
    @employer = User.create!(name: "AI Employer", email: "ai-employer@example.com", password: PASSWORD, role: "employer", status: "active", email_verified: true)
    @token = session_for(@jobseeker)
    @employer_token = session_for(@employer)
    # These tests exercise rate limiting/budgets, not the credits ledger (covered separately in
    # ai_credits_test.rb) — grant plenty of credits so a loop of calls never hits AI_CREDITS_EXHAUSTED.
    grant_ai_credits(@jobseeker, 1000)
    grant_ai_credits(@employer, 1000)
  end

  teardown { Rails.cache = @original_cache }

  test "status reports disabled with no key configured, and lists only the launch-enabled tasks" do
    with_env("ANTHROPIC_API_KEY" => nil) do
      get "/api/ai/status"
      assert_response :success
      body = response.parsed_body
      assert_equal false, body.fetch("enabled")
      assert_equal %w[profile_headline profile_bio job_description job_screening_questions].sort, body.fetch("tasks").sort
      assert_not_includes body.fetch("tasks"), "autocomplete"
      assert_not_includes body.fetch("tasks"), "post_caption"
      assert_not_includes body.fetch("tasks"), "cover_letter"
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
      post "/api/ai/suggest", params: { task: "profile_headline", context: {} }, headers: bearer(@token), as: :json
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

  test "suggest answers 403 AI_TASK_DISABLED for every task outside the launch allow-list" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      # classify_portfolio_item is never in AiAssist::Tasks::REGISTRY at all (it's the batch-only
      # AiPortfolioItemClassifier, with its own prompt, and was never reachable through
      # POST /api/ai/suggest even before launch mode) — so it stays a plain 422 UNKNOWN_TASK,
      # covered by "suggest rejects an unknown task" above.
      disabled_tasks = %w[cover_letter post_caption message_reply resume_summary improve_text portfolio_blurb
        candidate_summary rank_applicants outreach_message interview_questions rejection_note
        draft_portfolio tailor_resume]
      disabled_tasks.each do |task|
        post "/api/ai/suggest", params: { task:, context: {} }, headers: bearer(@token), as: :json
        assert_response :forbidden
        assert_equal "AI_TASK_DISABLED", response.parsed_body["code"], "expected #{task} to be disabled"
      end
    end
  end

  test "suggest returns a suggestion on success and never exposes the task through /suggest for the internal autocomplete task" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      stub_anthropic_success("Session guitarist for Hindi and English rock acts") do
        post "/api/ai/suggest", params: { task: "profile_headline", context: { roles: ["Guitarist"] } }, headers: bearer(@token), as: :json
      end
      assert_response :success
      body = response.parsed_body
      assert_equal "Session guitarist for Hindi and English rock acts", body.fetch("suggestion")
      assert_equal "profile_headline", body.fetch("task")

      post "/api/ai/suggest", params: { task: "autocomplete", context: { field: "cities", query: "mu" } }, headers: bearer(@token), as: :json
      assert_response :unprocessable_content
      assert_equal "UNKNOWN_TASK", response.parsed_body["code"]
    end
  end

  test "suggest enforces the per-user hourly rate limit" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      AiPricing.stub(:talent_lifetime_limit, 1000) do
        stub_anthropic_success("ok") do
          AiController::SUGGEST_LIMIT_PER_HOUR.times do
            post "/api/ai/suggest", params: { task: "profile_headline", context: {} }, headers: bearer(@token), as: :json
            assert_response :success
          end
          post "/api/ai/suggest", params: { task: "profile_headline", context: {} }, headers: bearer(@token), as: :json
        end
        assert_response :too_many_requests
        assert_equal "RATE_LIMITED", response.parsed_body["code"]
      end
    end
  end

  test "suggest answers 429 AI_BUDGET_EXHAUSTED once the global daily cap is spent" do
    with_env("ANTHROPIC_API_KEY" => "sk-test", "AI_DAILY_REQUEST_CAP" => "1") do
      stub_anthropic_success("ok") do
        post "/api/ai/suggest", params: { task: "profile_headline", context: {} }, headers: bearer(@token), as: :json
        assert_response :success
        post "/api/ai/suggest", params: { task: "profile_headline", context: {} }, headers: bearer(@employer_token), as: :json
      end
      assert_response :too_many_requests
      assert_equal "AI_BUDGET_EXHAUSTED", response.parsed_body["code"]
    end
  end

  test "the talent lifetime usage cap answers 402 AI_USAGE_LIMIT_REACHED once used up" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      stub_anthropic_success("A headline") do
        AiPricing.talent_lifetime_limit.times do
          post "/api/ai/suggest", params: { task: "profile_headline", context: {} }, headers: bearer(@token), as: :json
          assert_response :success
        end
        post "/api/ai/suggest", params: { task: "profile_bio", context: {} }, headers: bearer(@token), as: :json
      end
      assert_response :payment_required
      body = response.parsed_body
      assert_equal "AI_USAGE_LIMIT_REACHED", body["code"]
      assert_equal 0, body["remaining"]
      assert_equal AiPricing.talent_lifetime_limit, body["limit"]
      assert_equal "lifetime", body["period"]
    end
  end

  test "the hirer monthly usage cap answers 402 AI_USAGE_LIMIT_REACHED once used up this month" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      stub_anthropic_success("A description.") do
        AiPricing.hirer_monthly_limit.times do
          post "/api/ai/suggest", params: { task: "job_description", context: { title: "Session bassist" } }, headers: bearer(@employer_token), as: :json
          assert_response :success
        end
        post "/api/ai/suggest", params: { task: "job_screening_questions", context: { title: "Session bassist" } }, headers: bearer(@employer_token), as: :json
      end
      assert_response :payment_required
      body = response.parsed_body
      assert_equal "AI_USAGE_LIMIT_REACHED", body["code"]
      assert_equal "month", body["period"]
    end
  end

  test "GET /api/ai/usage reports the caller's own launch task group" do
    get "/api/ai/usage", headers: bearer(@token)
    assert_response :success
    body = response.parsed_body
    assert_equal AiPricing.talent_lifetime_limit, body["limit"]
    assert_equal "lifetime", body["period"]
    assert_equal AiPricing.talent_lifetime_limit, body["remaining"]

    get "/api/ai/usage", headers: bearer(@employer_token)
    assert_response :success
    body = response.parsed_body
    assert_equal AiPricing.hirer_monthly_limit, body["limit"]
    assert_equal "month", body["period"]
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
        post "/api/ai/suggest", params: { task: "profile_headline", context: {} }, headers: bearer(@token), as: :json
      end
      assert_response :bad_gateway
      assert_equal "AI_TIMEOUT", response.parsed_body["code"]
    end
  end

  test "a malformed upstream response surfaces as a friendly error, not a 500" do
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      stub_anthropic_body("not json") do
        post "/api/ai/suggest", params: { task: "profile_headline", context: {} }, headers: bearer(@token), as: :json
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

  def grant_ai_credits(user, credits)
    resolution = AiCreditAccount.for(user)
    AiCreditLedger.create!(account_type: resolution.account_type, account_id: resolution.account_id, delta: credits, reason: "admin_grant")
  end

  def with_env(values)
    previous = values.keys.to_h { [_1, ENV[_1]] }
    values.each { |key, value| ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| ENV[key] = value }
  end
end
