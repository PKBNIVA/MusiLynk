require "test_helper"

class AiAssistTest < ActiveSupport::TestCase
  FakeClient = Struct.new(:status, :body, :calls) do
    def post(url, headers:, body:, open_timeout:, read_timeout:)
      calls << { url:, headers:, body:, open_timeout:, read_timeout: }
      [status, self.body]
    end
  end

  RaisingClient = Struct.new(:error) do
    def post(*) = raise error
  end

  test "enabled? requires a key and is off when AI_ASSIST_ENABLED=false" do
    with_env("ANTHROPIC_API_KEY" => "sk-test", "AI_ASSIST_ENABLED" => nil) { assert AiAssist.enabled? }
    with_env("ANTHROPIC_API_KEY" => "", "AI_ASSIST_ENABLED" => nil) { assert_not AiAssist.enabled? }
    with_env("ANTHROPIC_API_KEY" => "sk-test", "AI_ASSIST_ENABLED" => "false") { assert_not AiAssist.enabled? }
  end

  test "model names fall back to defaults and read AI_MODEL / AI_MODEL_LONG" do
    with_env("AI_MODEL" => nil, "AI_MODEL_LONG" => nil) do
      assert_equal "claude-haiku-4-5-20251001", AiAssist.model_name
      assert_equal "claude-sonnet-5", AiAssist.long_model_name
    end
    with_env("AI_MODEL" => "custom-fast", "AI_MODEL_LONG" => "custom-long") do
      assert_equal "custom-fast", AiAssist.model_name
      assert_equal "custom-long", AiAssist.long_model_name
    end
  end

  test "raises AI_DISABLED without calling the client when not enabled" do
    with_env("ANTHROPIC_API_KEY" => nil) do
      client = FakeClient.new(200, anthropic_body("hi"), [])
      error = assert_raises(AiAssist::Error) { AiAssist.new(client:).suggest(task: "post_caption", context: { kind: "release" }) }
      assert_equal "AI_DISABLED", error.code
      assert_empty client.calls
    end
  end

  test "a successful call sends the anthropic-version and key headers and returns a capped suggestion" do
    with_ai_enabled do
      client = FakeClient.new(200, anthropic_body("Check out our new single, out now everywhere!"), [])
      result = AiAssist.new(client:).suggest(task: "post_caption", context: { kind: "release", notes: "new single" })

      assert_equal "post_caption", result[:task]
      assert_equal "Check out our new single, out now everywhere!", result[:suggestion]
      assert_equal AiAssist::DEFAULT_MODEL, result[:model]

      call = client.calls.first
      assert_equal "2023-06-01", call[:headers]["anthropic-version"]
      assert_equal "sk-test", call[:headers]["x-api-key"]
      assert_equal 5, call[:open_timeout]
      assert_equal 20, call[:read_timeout]
      payload = JSON.parse(call[:body])
      assert_equal AiAssist::DEFAULT_MODEL, payload["model"]
      assert_includes payload["messages"].first["content"], "release"
    end
  end

  test "long-writing tasks use AI_MODEL_LONG" do
    with_ai_enabled do
      with_env("AI_MODEL_LONG" => "custom-long") do
        client = FakeClient.new(200, anthropic_body("A description."), [])
        result = AiAssist.new(client:).suggest(task: "job_description", context: { title: "Session Guitarist" })
        assert_equal "custom-long", result[:model]
      end
    end
  end

  test "unknown task raises UNKNOWN_TASK" do
    with_ai_enabled do
      error = assert_raises(AiAssist::Error) { AiAssist.new(client: FakeClient.new(200, "{}", [])).suggest(task: "not_a_task", context: {}) }
      assert_equal "UNKNOWN_TASK", error.code
    end
  end

  test "missing required context field raises INVALID_CONTEXT" do
    with_ai_enabled do
      error = assert_raises(AiAssist::Error) { AiAssist.new(client: FakeClient.new(200, "{}", [])).suggest(task: "post_caption", context: {}) }
      assert_equal "INVALID_CONTEXT", error.code
    end
  end

  test "improve_text rejects a tone outside the allow-list" do
    with_ai_enabled do
      error = assert_raises(AiAssist::Error) do
        AiAssist.new(client: FakeClient.new(200, "{}", [])).suggest(task: "improve_text", context: { tone: "rude", text: "hello" })
      end
      assert_equal "INVALID_CONTEXT", error.code
    end
  end

  test "context strings are HTML-stripped and length-capped before they ever reach the prompt" do
    with_ai_enabled do
      client = FakeClient.new(200, anthropic_body("ok"), [])
      long_notes = "<script>alert(1)</script>" + ("x" * 900)
      AiAssist.new(client:).suggest(task: "post_caption", context: { kind: "release", notes: long_notes })
      content = JSON.parse(client.calls.first[:body])["messages"].first["content"]
      assert_not_includes content, "<script>"
      assert_not_includes content, "</script>"
    end
  end

  test "a timeout from the client is surfaced as AI_TIMEOUT and logs no prompt text" do
    with_ai_enabled do
      client = RaisingClient.new(Net::ReadTimeout.new)
      logged = capture_logs { assert_raises(AiAssist::Error) { AiAssist.new(client:).suggest(task: "post_caption", context: { kind: "release" }) } }
      assert_includes logged, "timeout"
      assert_not_includes logged, "release"
    end
  end

  test "a non-200 upstream response is AI_UPSTREAM_ERROR" do
    with_ai_enabled do
      client = FakeClient.new(500, "server error", [])
      error = assert_raises(AiAssist::Error) { AiAssist.new(client:).suggest(task: "post_caption", context: { kind: "release" }) }
      assert_equal "AI_UPSTREAM_ERROR", error.code
    end
  end

  test "malformed JSON from the upstream is AI_MALFORMED_RESPONSE" do
    with_ai_enabled do
      client = FakeClient.new(200, "not json", [])
      error = assert_raises(AiAssist::Error) { AiAssist.new(client:).suggest(task: "post_caption", context: { kind: "release" }) }
      assert_equal "AI_MALFORMED_RESPONSE", error.code
    end
  end

  test "a response missing content blocks is AI_MALFORMED_RESPONSE" do
    with_ai_enabled do
      client = FakeClient.new(200, { usage: { input_tokens: 1, output_tokens: 1 } }.to_json, [])
      error = assert_raises(AiAssist::Error) { AiAssist.new(client:).suggest(task: "post_caption", context: { kind: "release" }) }
      assert_equal "AI_MALFORMED_RESPONSE", error.code
    end
  end

  test "an empty text response is AI_MALFORMED_RESPONSE" do
    with_ai_enabled do
      client = FakeClient.new(200, anthropic_body(""), [])
      error = assert_raises(AiAssist::Error) { AiAssist.new(client:).suggest(task: "post_caption", context: { kind: "release" }) }
      assert_equal "AI_MALFORMED_RESPONSE", error.code
    end
  end

  test "logging never includes the prompt, the context or the api key" do
    with_ai_enabled do
      client = FakeClient.new(200, anthropic_body("A secret-looking suggestion about sk-test"), [])
      logged = capture_logs { AiAssist.new(client:).suggest(task: "post_caption", context: { kind: "release", notes: "top secret notes" }) }
      assert_not_includes logged, "top secret notes"
      assert_not_includes logged, "sk-test"
      assert_includes logged, "ai_assist"
      assert_includes logged, "\"status\":\"ok\""
    end
  end

  test "message_reply builds a them/me transcript into the prompt" do
    with_ai_enabled do
      client = FakeClient.new(200, anthropic_body("Sounds good, see you then!"), [])
      AiAssist.new(client:).suggest(task: "message_reply", context: { messages: ["them: are you free Friday?", "me: let me check"] })
      payload = JSON.parse(client.calls.first[:body])
      assert_includes payload["messages"].first["content"], "them: are you free Friday?"
    end
  end

  private

  def with_ai_enabled(&)
    with_env("ANTHROPIC_API_KEY" => "sk-test", "AI_ASSIST_ENABLED" => nil, &)
  end

  def anthropic_body(text)
    { content: [{ type: "text", text: }], usage: { input_tokens: 12, output_tokens: 8 } }.to_json
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
    values.each { |key, value| ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| ENV[key] = value }
  end
end
