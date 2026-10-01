require "test_helper"
require "minitest/mock"
require_relative "../../support/showcase_helpers"

class LinkImport::ProfileDraftTest < ActiveSupport::TestCase
  include ShowcaseHelpers

  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
  end

  teardown { Rails.cache = @original_cache }

  test "deterministic pass finds a taxonomy role label, an instrument, a city, years and a credit, each with its source_url" do
    stub_resolver("https://example.com/a" => {
      provider: "link", kind: "page", url: "https://example.com/a",
      title: "Session Guitarist", author: nil,
      description: "Bengaluru-based acoustic guitar player, playing since 2014. Recorded for major film scores.", thumbnail: nil
    })

    result = build(["https://example.com/a"])
    draft = result.draft

    assert_includes draft[:roles], "Artists & performers"
    assert_includes draft[:instruments], "Acoustic Guitar"
    assert_equal "Bengaluru", draft[:city]
    assert_equal Date.today.year - 2014, draft[:yearsExperience]
    credit = draft[:credits].first
    assert_equal "major film scores", credit[:text]
    assert_equal "https://example.com/a", credit[:source_url]
    assert_equal "https://example.com/a", result.provenance["city"]
    assert_not result.ai_used
  end

  test "what the person already entered fills the draft, and a link that cannot be read is reported" do
    stub_resolver("https://example.com/a" => { provider: "link", kind: "page", url: "https://example.com/a", title: nil, author: nil, description: nil, thumbnail: nil },
      "https://example.com/gone" => LinkPreview::InvalidUrl.new("That doesn't look like a web link."))

    result = build(["https://example.com/a", "https://example.com/gone"], known: { roles: ["Tabla player"], city: "Mumbai" })

    assert_equal ["Tabla player"], result.draft[:roles]
    assert_equal "Mumbai", result.draft[:city]
    assert_equal 1, result.failures.length
    assert_equal "https://example.com/gone", result.failures.first[:url]
    assert_equal result.failures, result.as_json[:failures]
  end

  test "\"xx years\" phrasing is also recognised" do
    stub_resolver("https://example.com/b" => { provider: "link", kind: "page", url: "https://example.com/b", title: "Drummer", author: nil,
                                                 description: "10 years of touring experience.", thumbnail: nil })
    draft = build(["https://example.com/b"]).draft
    assert_equal 10, draft[:yearsExperience]
  end

  test "Spotify artist genres feed the deterministic genre list directly" do
    stub_resolver("https://open.spotify.com/artist/x" => { provider: "spotify", kind: "audio", url: "https://open.spotify.com/artist/x",
                                                             title: "Some Artist", author: nil, thumbnail: nil,
                                                             artist: { name: "Some Artist", genres: %w[Indie Pop], image: nil, followers: 100 }, tracks: [] })
    draft = build(["https://open.spotify.com/artist/x"]).draft
    assert_includes draft[:genres], "Indie"
    assert_includes draft[:genres], "Pop"
  end

  test "without AI enabled, the draft is the deterministic one and aiUsed is false" do
    stub_resolver("https://example.com/c" => { provider: "link", kind: "page", url: "https://example.com/c", title: "Singer", author: nil, description: "Vocalist", thumbnail: nil })
    with_env("ANTHROPIC_API_KEY" => nil) do
      result = build(["https://example.com/c"])
      assert_not result.ai_used
      assert_nil result.draft[:headline]
    end
  end

  test "AI output drops a credit whose source_url isn't one of the given links and a role outside the taxonomy" do
    stub_resolver("https://example.com/d" => { provider: "link", kind: "page", url: "https://example.com/d", title: "Producer", author: nil, description: "Music producer", thumbnail: nil })
    ai_json = {
      headline: "Music producer from Mumbai", bio: "I make beats.",
      roles: ["Producers & engineers", "Astronaut"],
      genres: ["Hip-Hop"], instruments: ["Sampler"],
      credits: [{ text: "toured with a famous band", source_url: "https://example.com/d" },
                { text: "invented from nowhere", source_url: "https://evil.example/not-given" }],
      items: [{ url: "https://example.com/d", title: "Producer", caption: "Music producer" }]
    }.to_json

    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      user = make_user("Ai User")
      result = build(["https://example.com/d"], identity: { user: }, ai: FakeAi.new(ai_json))
      assert result.ai_used
      assert_equal ["Producers & engineers"], result.draft[:roles]
      assert_equal 1, result.draft[:credits].length
      assert_equal "toured with a famous band", result.draft[:credits].first[:text]
    end
  end

  test "falls back to the deterministic draft once the signed-in lifetime AI limit is used up" do
    stub_resolver("https://example.com/e" => { provider: "link", kind: "page", url: "https://example.com/e", title: "Bassist", author: nil, description: "Bassist", thumbnail: nil })
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      user = make_user("Capped User")
      LinkImport::Budget::TALENT_LIFETIME_LIMIT.times do
        LinkImport::Budget.record_spend!(user, cost_inr: 1)
      end
      result = build(["https://example.com/e"], identity: { user: }, ai: FakeAi.new_raising)
      assert_not result.ai_used
    end
  end

  test "falls back to the deterministic draft once the anonymous per-IP run is used up" do
    stub_resolver("https://example.com/f" => { provider: "link", kind: "page", url: "https://example.com/f", title: "Pianist", author: nil, description: "Pianist", thumbnail: nil })
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      LinkImport::Budget.record_anonymous!("203.0.113.5")
      result = build(["https://example.com/f"], identity: { anonymous_ip: "203.0.113.5" })
      assert_not result.ai_used
    end
  end

  test "falls back to the deterministic draft once the monthly profile-import budget is exhausted" do
    stub_resolver("https://example.com/g" => { provider: "link", kind: "page", url: "https://example.com/g", title: "Cellist", author: nil, description: "Cellist", thumbnail: nil })
    with_env("ANTHROPIC_API_KEY" => "sk-test") do
      user = make_user("Budget User")
      LinkImport::Budget.record_spend!(user, cost_inr: AiPricing.config.fetch(:profile_import_monthly_budget_inr))
      result = build(["https://example.com/g"], identity: { user: })
      assert_not result.ai_used
    end
  end

  private

  FakeResolver = Struct.new(:map) do
    def call(url, own_hosts: [])
      value = map.fetch(url)
      raise value if value.is_a?(Exception)
      value
    end
  end

  FakeAi = Struct.new(:json) do
    def self.new_raising = new(nil).tap { |ai| ai.define_singleton_method(:suggest) { |*| raise "should not be called" } }

    def suggest(task:, context:) = { suggestion: json, task:, model: "haiku", inputTokens: 100, outputTokens: 50 }
  end

  # Replaces LinkImport::ProfileDraft.build's default resolver for the rest of this test.
  def stub_resolver(map)
    @resolver = FakeResolver.new(map)
  end

  def build(urls, **options)
    LinkImport::ProfileDraft.build(urls, resolver: @resolver, **options)
  end

  def with_env(values)
    previous = values.keys.index_with { ENV[_1] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
