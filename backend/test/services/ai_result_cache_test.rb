require "test_helper"

class AiResultCacheTest < ActiveSupport::TestCase
  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  test "identical context (any key order/whitespace) hits the same cache entry" do
    a = { "kind" => " release ", "notes" => "x" }
    b = { "notes" => "x", "kind" => "release" }
    assert_equal AiResultCache.key_for("post_caption", a, "user", "u1"), AiResultCache.key_for("post_caption", b, "user", "u1")
  end

  test "write then fetch returns the cached value; regenerate bypasses both" do
    AiResultCache.write("post_caption", { kind: "release" }, "user", "u1", { suggestion: "hi" })
    assert_equal({ suggestion: "hi" }, AiResultCache.fetch("post_caption", { kind: "release" }, "user", "u1"))
    assert_nil AiResultCache.fetch("post_caption", { kind: "release" }, "user", "u1", regenerate: true)
  end

  test "a different task or account never shares a cache entry" do
    AiResultCache.write("post_caption", { kind: "release" }, "user", "u1", { suggestion: "hi" })
    assert_nil AiResultCache.fetch("job_description", { kind: "release" }, "user", "u1")
    assert_nil AiResultCache.fetch("post_caption", { kind: "release" }, "user", "u2")
  end
end
