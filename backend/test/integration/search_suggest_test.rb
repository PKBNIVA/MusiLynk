require "test_helper"

# GET /api/search/suggest: the search box's type-ahead (Search::Suggest).
class SearchSuggestTest < ActionDispatch::IntegrationTest
  setup do
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @tabassum = person("Tabassum Ali", headline: "Singer from Pune")
    @hidden = person("Tabish Hidden", synthetic_batch: "local-qa")
    @demo = person("Tabby Demo", synthetic_batch: "demo-20261003-0900")
    Act.create!(owner: @tabassum, name: "Taal Tabla Trio", act_type: "trio", city: "Pune", currency: "INR", fee_basis: "event", status: "active")
    Act.create!(owner: @hidden, name: "Tabla Hidden Act", act_type: "band", currency: "INR", fee_basis: "event", status: "active")
  end

  teardown { Rails.cache = @original_cache }

  test "anyone gets roles, instruments, cities, people and acts that start with what was typed" do
    get "/api/search/suggest", params: { q: "tab" }
    assert_response :success
    suggestions = response.parsed_body.fetch("suggestions")
    assert_equal "Tabla player", suggestions.first["label"], "the vocabulary label comes first"
    assert_equal({ "kind" => "role", "label" => "Tabla player", "query" => "Tabla player" }, suggestions.first)
    names = suggestions.select { _1["kind"] == "name" }
    assert_includes names, { "kind" => "name", "label" => "Tabassum Ali", "detail" => "Singer from Pune", "url" => "/professionals/#{@tabassum.id}" }
    assert_includes suggestions.pluck("label"), "Taal Tabla Trio", "a later word of an act's name matches"
    assert_equal suggestions.pluck("kind"), suggestions.pluck("kind").sort_by { Search::Suggest::KIND_ORDER.index(_1) }, "grouped by kind"
    assert_operator suggestions.size, :<=, Search::Settings.suggest.fetch("max_total")
    assert_match(/max-age=60/, response.headers["Cache-Control"])
    assert_match(/private/, response.headers["Cache-Control"])
  end

  test "Hinglish, Devanagari and city aliases suggest the group's label" do
    { "gaya" => "Singer", "गाय" => "Singer", "shaa" => "Wedding", "bomb" => "Mumbai", "dhola" => "Dholak player" }.each do |typed, label|
      get "/api/search/suggest", params: { q: typed }
      assert_includes response.parsed_body.fetch("suggestions").pluck("label"), label, typed
    end
    get "/api/search/suggest", params: { q: "dhol" }
    labels = response.parsed_body.fetch("suggestions").pluck("label")
    assert_equal ["Dhol player", "Dholak player"], labels.first(2), "the shorter exact name first; both are offered"
  end

  test "hidden synthetic people and acts are never suggested to real visitors; demo ones are" do
    get "/api/search/suggest", params: { q: "tab" }
    labels = response.parsed_body.fetch("suggestions").pluck("label")
    assert_not_includes labels, "Tabish Hidden"
    assert_not_includes labels, "Tabla Hidden Act"
    assert_includes labels, "Tabby Demo"

    viewer = person("QA Viewer", synthetic_batch: "local-qa")
    raw = SecureRandom.urlsafe_base64(48)
    viewer.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    get "/api/search/suggest", params: { q: "tab" }, headers: { "Authorization" => "Bearer #{raw}" }
    assert_includes response.parsed_body.fetch("suggestions").pluck("label"), "Tabish Hidden", "synthetic viewers see their own batch"
  end

  test "short, empty, code-like and non-text input returns nothing or a 400" do
    ["", "t", " ", "%", "'; --"].each do |q|
      get "/api/search/suggest", params: { q: }
      assert_response :success
      assert_equal [], response.parsed_body["suggestions"], q.inspect
    end
    get "/api/search/suggest"
    assert_equal [], response.parsed_body["suggestions"]
    get "/api/search/suggest", params: { q: ["tab"] }
    assert_response :bad_request
    assert_equal "INVALID_PARAMETER", response.parsed_body["code"]
    get "/api/search/suggest", params: { q: "tab#{'x' * 500}" }
    assert_response :success
  end

  test "answers are cached for a minute per text" do
    freeze_time
    get "/api/search/suggest", params: { q: "tabas" }
    assert_equal ["Tabassum Ali"], response.parsed_body["suggestions"].pluck("label")
    person("Tabassum Second")
    get "/api/search/suggest", params: { q: "TABAS " }
    assert_equal ["Tabassum Ali"], response.parsed_body["suggestions"].pluck("label"), "the same normalised text is served from the cache"
    travel 61.seconds
    get "/api/search/suggest", params: { q: "tabas" }
    assert_equal ["Tabassum Ali", "Tabassum Second"], response.parsed_body["suggestions"].pluck("label")
  end

  test "each IP gets a bounded number of suggestions per minute" do
    freeze_time
    limit = Search::Settings.suggest.fetch("requests_per_minute")
    limit.times { get "/api/search/suggest", params: { q: "ta" } }
    assert_response :success
    get "/api/search/suggest", params: { q: "ta" }
    assert_response :too_many_requests
    get "/api/search/suggest", params: { q: "ta" }, env: { "REMOTE_ADDR" => "203.0.113.20" }
    assert_response :success
  end

  test "two queries whatever the number of matching people and acts" do
    10.times { |i| person("Tabular Person #{i}") }
    get "/api/search/suggest", params: { q: "zz-warm" }
    queries = []
    callback = ->(*, payload) { queries << payload[:sql] unless %w[SCHEMA TRANSACTION].include?(payload[:name]) || payload[:cached] }
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { get "/api/search/suggest", params: { q: "tabu" } }
    assert_response :success
    assert_equal 2, queries.size, queries.join("\n")
    assert(queries.all? { _1.include?("LIMIT") }, "every lookup is bounded")
  end

  private

  def person(name, headline: "Session player", synthetic_batch: nil)
    user = User.create!(name:, email: "#{name.parameterize}-#{SecureRandom.hex(3)}@example.invalid", password: "StrongPass123!", role: "jobseeker",
      status: "active", profile_complete: true, synthetic_batch:)
    user.create_profile!(headline:, location: "Pune")
    user
  end
end
