require "test_helper"

# The web app (Vercel) calls the API (Railway) cross-origin, so every browser request depends on these headers.
class CorsTest < ActionDispatch::IntegrationTest
  ALLOWED = "http://localhost:5173".freeze

  test "preflight from the allowed origin is answered with the allowed methods and headers" do
    process :options, "/api/auth/login", headers: {
      "Origin" => ALLOWED,
      "Access-Control-Request-Method" => "POST",
      "Access-Control-Request-Headers" => "content-type, authorization"
    }
    assert_response :success
    assert_equal ALLOWED, response.headers["Access-Control-Allow-Origin"]
    assert_includes response.headers["Access-Control-Allow-Methods"].to_s, "POST"
    assert_match(/authorization/i, response.headers["Access-Control-Allow-Headers"].to_s)
  end

  test "simple requests from the allowed origin carry the allow-origin header" do
    get "/api/live", headers: { "Origin" => ALLOWED }
    assert_response :success
    assert_equal ALLOWED, response.headers["Access-Control-Allow-Origin"]
  end

  test "other origins get no allow-origin header" do
    get "/api/live", headers: { "Origin" => "https://evil.example" }
    assert_nil response.headers["Access-Control-Allow-Origin"]

    process :options, "/api/auth/login", headers: { "Origin" => "https://evil.example", "Access-Control-Request-Method" => "POST" }
    assert_nil response.headers["Access-Control-Allow-Origin"]
  end

  test "a 413 from the body size limit is still readable by the browser" do
    post "/api/auth/login", params: { email: "a@example.com", password: "x" * (1.megabyte + 10) }, headers: { "Origin" => ALLOWED }, as: :json
    assert_response :content_too_large
    assert_equal ALLOWED, response.headers["Access-Control-Allow-Origin"]
  end
end

# With ADMIN_ORIGIN set, browsers on the public site can no longer reach the admin API, and the
# admin site reaches only what it needs. Origins are read per request, so the lock is testable here.
class AdminOriginCorsTest < ActionDispatch::IntegrationTest
  PUBLIC = "http://localhost:5173".freeze
  ADMIN = "https://verse-admin-abcd.vercel.app".freeze

  test "the public origin is refused on the admin API but keeps every other route" do
    with_env("ADMIN_ORIGIN" => ADMIN) do
      preflight("/api/admin/users", PUBLIC)
      assert_nil response.headers["Access-Control-Allow-Origin"]
      get "/api/admin/users", headers: { "Origin" => PUBLIC }
      assert_nil response.headers["Access-Control-Allow-Origin"]

      %w[/api/auth/login /api/auth/otp/request /api/jobs /api/me /api/auth/logout].each do |path|
        preflight(path, PUBLIC)
        assert_equal PUBLIC, response.headers["Access-Control-Allow-Origin"], path
      end
      get "/api/live", headers: { "Origin" => PUBLIC }
      assert_equal PUBLIC, response.headers["Access-Control-Allow-Origin"]
    end
  end

  test "the admin origin reaches the admin API and sign-in, but not the rest of the API" do
    with_env("ADMIN_ORIGIN" => ADMIN) do
      %w[/api/admin/users /api/admin/account/email/request /api/auth/login /api/auth/second-factor /api/auth/logout /api/auth/methods /api/me].each do |path|
        preflight(path, ADMIN)
        assert_equal ADMIN, response.headers["Access-Control-Allow-Origin"], path
        assert_match(/authorization/i, response.headers["Access-Control-Allow-Headers"].to_s)
      end
      %w[/api/jobs /api/auth/otp/request /api/auth/register /api/conversations /api/mesh /api/meander].each do |path|
        preflight(path, ADMIN)
        assert_nil response.headers["Access-Control-Allow-Origin"], path
      end
      get "/api/live", headers: { "Origin" => ADMIN }
      assert_nil response.headers["Access-Control-Allow-Origin"]
      preflight("/api/admin/users", "https://verse-admin-abcd.vercel.app.evil.example")
      assert_nil response.headers["Access-Control-Allow-Origin"]
    end
  end

  test "a trailing slash in ADMIN_ORIGIN still matches the browser's origin" do
    with_env("ADMIN_ORIGIN" => "#{ADMIN}/") do
      preflight("/api/admin/users", ADMIN)
      assert_equal ADMIN, response.headers["Access-Control-Allow-Origin"]
    end
  end

  test "without ADMIN_ORIGIN the public origin reaches the admin API as before" do
    with_env("ADMIN_ORIGIN" => nil) do
      preflight("/api/admin/users", PUBLIC)
      assert_equal PUBLIC, response.headers["Access-Control-Allow-Origin"]
      preflight("/api/admin/users", ADMIN)
      assert_nil response.headers["Access-Control-Allow-Origin"]
    end
  end

  private

  def preflight(path, origin)
    process :options, path, headers: { "Origin" => origin, "Access-Control-Request-Method" => "POST", "Access-Control-Request-Headers" => "content-type, authorization" }
  end

  def with_env(values)
    previous = values.keys.index_with { ENV[_1] }
    values.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end
end
