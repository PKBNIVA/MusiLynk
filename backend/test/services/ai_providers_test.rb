require "test_helper"

class AiProvidersTest < ActiveSupport::TestCase
  # Scripted HTTP client: pops one [status, body] per call and records every request.
  class ScriptedClient
    attr_reader :calls

    def initialize(*responses) = (@responses = responses; @calls = [])

    def post(url, headers:, body:, open_timeout:, read_timeout:)
      @calls << { url:, headers:, body: JSON.parse(body), open_timeout:, read_timeout: }
      @responses.shift || raise("no scripted response left")
    end
  end

  OPENAI = { "AI_PROVIDER" => "openai", "OPENAI_API_KEY" => "sk-openai-test", "OPENAI_MODEL" => nil, "AI_ASSIST_ENABLED" => nil }.freeze

  setup { AiAssist::Providers::OpenAi.retry_delay_range = 0..0 }

  test "the shipped default provider is openai and the model is gpt-5.6-luna" do
    default = YAML.safe_load(File.read(AiPricing::CONFIG_PATH), aliases: true).fetch("default")
    assert_equal "openai", default.fetch("provider")
    assert_equal "gpt-5.6-luna", default.dig("providers", "openai", "model")
    assert_equal "claude-haiku-4-5-20251001", default.dig("providers", "anthropic", "model")
  end

  test "AI_PROVIDER selects the provider, an invalid value falls back to config" do
    with_env("AI_PROVIDER" => "openai") do
      assert_equal AiAssist::Providers::OpenAi, AiAssist.provider_class
      assert_equal "gpt-5.6-luna", AiAssist.model_name
    end
    with_env("AI_PROVIDER" => "anthropic", "AI_MODEL" => nil) do
      assert_equal AiAssist::Providers::Anthropic, AiAssist.provider_class
      assert_equal AiAssist::DEFAULT_MODEL, AiAssist.model_name
    end
    with_env("AI_PROVIDER" => "bogus") { assert_equal AiPricing.config.fetch(:provider), AiPricing.provider }
    with_env("AI_PROVIDER" => "openai", "OPENAI_MODEL" => "gpt-5.4-mini") { assert_equal "gpt-5.4-mini", AiAssist.model_name }
  end

  test "enabled? follows the selected provider's key" do
    with_env(OPENAI.merge("OPENAI_API_KEY" => nil, "ANTHROPIC_API_KEY" => "sk-ant")) { assert_not AiAssist.enabled? }
    with_env(OPENAI) { assert AiAssist.enabled? }
    with_env(OPENAI.merge("AI_ASSIST_ENABLED" => "false")) { assert_not AiAssist.enabled? }
    with_env("AI_PROVIDER" => "anthropic", "ANTHROPIC_API_KEY" => "sk-ant", "OPENAI_API_KEY" => nil, "AI_ASSIST_ENABLED" => nil) { assert AiAssist.enabled? }
    with_env("AI_PROVIDER" => "anthropic", "ANTHROPIC_API_KEY" => nil, "OPENAI_API_KEY" => "sk-openai-test") { assert_not AiAssist.enabled? }
  end

  test "OpenAI request: model, instructions first, max_output_tokens, no reasoning, key header, 30 s read timeout" do
    with_env(OPENAI) do
      client = ScriptedClient.new([200, openai_body("A drummer for hire.")])
      result = AiAssist.new(client:).suggest(task: "profile_headline", context: { role: "Drummer", city: "Pune" })

      call = client.calls.sole
      assert_equal "https://api.openai.com/v1/responses", call[:url]
      assert_equal "Bearer sk-openai-test", call[:headers]["authorization"]
      assert_equal 5, call[:open_timeout]
      assert_equal 30, call[:read_timeout]
      body = call[:body]
      assert_equal "gpt-5.6-luna", body["model"]
      assert_equal AiAssist.max_tokens_for("profile_headline"), body["max_output_tokens"]
      assert_equal({ "effort" => "none" }, body["reasoning"])
      assert_equal false, body["store"]
      assert_includes body["instructions"], "Use only"
      assert_equal "user", body["input"].first["role"]
      assert_includes body["input"].first["content"], "Pune"
      assert_nil body["text"], "plain-text tasks send no schema"
      assert_equal "A drummer for hire.", result[:suggestion]
      assert_equal "gpt-5.6-luna", result[:model]
      assert_equal "openai", result[:provider]
    end
  end

  test "JSON tasks send a strict json_schema and screening questions come back one per line" do
    with_env(OPENAI) do
      questions = { questions: ["Which DAWs do you use?", "Are you free weekends?", "Share a live clip."] }.to_json
      client = ScriptedClient.new([200, openai_body(questions)])
      result = AiAssist.new(client:).suggest(task: "job_screening_questions", context: { title: "Session drummer" })

      format = client.calls.sole[:body].dig("text", "format")
      assert_equal "json_schema", format["type"]
      assert_equal true, format["strict"]
      assert_equal "screening_questions", format["name"]
      assert_equal false, format.dig("schema", "additionalProperties")
      assert_equal "Which DAWs do you use?\nAre you free weekends?\nShare a live clip.", result[:suggestion]
    end

    with_env(OPENAI) do
      draft = { headline: "Drummer", bio: "Plays.", roles: [], genres: [], instruments: ["Drums"], credits: [], items: [] }.to_json
      client = ScriptedClient.new([200, openai_body(draft)])
      result = AiAssist.new(client:).suggest(task: "profile_from_links", context: { sources: "URL: https://example.com/a\nTitle: A" })
      assert_equal "profile_draft", client.calls.sole[:body].dig("text", "format", "name")
      assert_equal "Drummer", JSON.parse(result[:suggestion])["headline"]
    end
  end

  test "usage is parsed including cached tokens and priced at the cached rate into INR" do
    with_env(OPENAI) do
      client = ScriptedClient.new([200, openai_body("Hello there", input: 1500, cached: 1000, output: 400)])
      result = AiAssist.new(client:).suggest(task: "profile_headline", context: { role: "Drummer" })
      assert_equal [1500, 1000, 400], result.values_at(:inputTokens, :cachedInputTokens, :outputTokens)

      # 500 uncached * 0.20 + 1000 cached * 0.02 + 400 out * 1.20 = 0.0006 USD * 85
      expected = ((500 * 0.20 + 1000 * 0.02 + 400 * 1.20) / 1_000_000.0 * 85).round(4)
      cost = AiPricing.estimate_cost_inr(input_tokens: 1500, cached_input_tokens: 1000, output_tokens: 400)
      assert_in_delta expected, cost, 0.00001
      assert_operator cost, :<, AiPricing.estimate_cost_inr(input_tokens: 1500, output_tokens: 400)
    end
  end

  test "the ledger row records tokens and the cached-aware INR cost" do
    with_env(OPENAI) do
      Rails.cache.clear
      user = User.create!(name: "Ledger User", email: "ledger-oai@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", email_verified: true)
      client = ScriptedClient.new([200, openai_body("Hello there", input: 1500, cached: 1000, output: 400)])
      AiOrchestrator.run(user:, task: "profile_headline", context: { role: "Drummer" }) { AiAssist.new(client:).suggest(task: "profile_headline", context: { role: "Drummer" }) }

      row = AiCreditLedger.where(reason: "usage", task: "profile_headline").order(:created_at).last
      assert_equal [1500, 400], [row.tokens_in, row.tokens_out]
      assert_in_delta AiPricing.estimate_cost_inr(input_tokens: 1500, cached_input_tokens: 1000, output_tokens: 400), row.cost_inr.to_f, 0.0001
    end
  end

  test "a 429 is retried once and then succeeds" do
    with_env(OPENAI) do
      client = ScriptedClient.new([429, '{"error":{"code":"rate_limit_exceeded"}}'], [200, openai_body("Recovered.")])
      result = AiAssist.new(client:).suggest(task: "profile_headline", context: { role: "Drummer" })
      assert_equal "Recovered.", result[:suggestion]
      assert_equal 2, client.calls.size
    end
  end

  test "a 5xx twice raises AI_UPSTREAM_ERROR after exactly two attempts" do
    with_env(OPENAI) do
      client = ScriptedClient.new([503, "{}"], [500, "{}"], [200, openai_body("never reached")])
      error = assert_raises(AiAssist::Error) { AiAssist.new(client:).suggest(task: "profile_headline", context: { role: "Drummer" }) }
      assert_equal "AI_UPSTREAM_ERROR", error.code
      assert_equal 500, error.http_status
      assert_equal 2, client.calls.size
    end
  end

  test "a 4xx other than 429 is not retried" do
    with_env(OPENAI) do
      client = ScriptedClient.new([401, "{}"])
      assert_raises(AiAssist::Error) { AiAssist.new(client:).suggest(task: "profile_headline", context: { role: "Drummer" }) }
      assert_equal 1, client.calls.size
    end
  end

  test "a refusal or content-filter stop raises AI_REFUSED" do
    with_env(OPENAI) do
      refusal = { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }], usage: { input_tokens: 10, output_tokens: 3 } }.to_json
      error = assert_raises(AiAssist::Error) { AiAssist.new(client: ScriptedClient.new([200, refusal])).suggest(task: "profile_headline", context: { role: "Drummer" }) }
      assert_equal "AI_REFUSED", error.code

      filtered = { status: "incomplete", incomplete_details: { reason: "content_filter" }, output: [], usage: {} }.to_json
      error = assert_raises(AiAssist::Error) { AiAssist.new(client: ScriptedClient.new([200, filtered])).suggest(task: "profile_headline", context: { role: "Drummer" }) }
      assert_equal "AI_REFUSED", error.code
    end
  end

  test "transport timeouts map to AI_TIMEOUT and garbage maps to AI_MALFORMED_RESPONSE" do
    with_env(OPENAI) do
      raising = Class.new { def post(*, **) = raise(Net::ReadTimeout) }.new
      assert_equal "AI_TIMEOUT", assert_raises(AiAssist::Error) { AiAssist.new(client: raising).suggest(task: "profile_headline", context: { role: "Drummer" }) }.code
      assert_equal "AI_MALFORMED_RESPONSE", assert_raises(AiAssist::Error) { AiAssist.new(client: ScriptedClient.new([200, "not json"])).suggest(task: "profile_headline", context: { role: "Drummer" }) }.code
    end
  end

  test "logs carry provider and counts but never the prompt or the key" do
    with_env(OPENAI) do
      logs = capture_logs { AiAssist.new(client: ScriptedClient.new([200, openai_body("Secret output text")])).suggest(task: "profile_headline", context: { role: "Unique-Role-Marker" }) }
      assert_includes logs, '"provider":"openai"'
      assert_not_includes logs, "Unique-Role-Marker"
      assert_not_includes logs, "Secret output text"
      assert_not_includes logs, "sk-openai-test"
    end
  end

  test "the Anthropic provider keeps its wire format behind the interface" do
    with_env("AI_PROVIDER" => "anthropic", "ANTHROPIC_API_KEY" => "sk-ant", "AI_MODEL" => nil, "AI_ASSIST_ENABLED" => nil) do
      body = { content: [{ type: "text", text: "Hi" }], usage: { input_tokens: 12, output_tokens: 8 } }.to_json
      client = ScriptedClient.new([200, body])
      result = AiAssist::Providers::Anthropic.new(client:).complete(system: "sys", messages: [{ role: "user", content: "hello" }], max_output_tokens: 50)

      assert_equal "Hi", result.text
      assert_equal [12, 0, 8], [result.input_tokens, result.cached_input_tokens, result.output_tokens]
      call = client.calls.sole
      assert_equal "https://api.anthropic.com/v1/messages", call[:url]
      assert_equal "sk-ant", call[:headers]["x-api-key"]
      assert_equal({ "model" => AiAssist::DEFAULT_MODEL, "max_tokens" => 50, "system" => "sys", "messages" => [{ "role" => "user", "content" => "hello" }] }, call[:body])
    end
  end

  private

  def openai_body(text, input: 40, cached: 0, output: 12)
    { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: }] }],
      usage: { input_tokens: input, input_tokens_details: { cached_tokens: cached }, output_tokens: output } }.to_json
  end

  def capture_logs
    previous = Rails.logger
    io = StringIO.new
    Rails.logger = Logger.new(io)
    yield
    io.string
  ensure
    Rails.logger = previous
  end

  def with_env(values)
    previous = values.keys.to_h { [_1, ENV[_1]] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
