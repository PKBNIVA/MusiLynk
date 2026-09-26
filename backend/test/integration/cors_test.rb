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
