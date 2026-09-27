require "test_helper"

# JSON responses are gzipped for clients that accept it and left alone for those that do not.
class ResponseCompressionTest < ActionDispatch::IntegrationTest
  test "JSON responses are gzipped when the client accepts gzip" do
    get "/api/resources", headers: { "Accept-Encoding" => "gzip, deflate, br" }
    assert_response :success
    assert_equal "gzip", response.headers["Content-Encoding"]
    assert_includes response.headers["Vary"].to_s, "Accept-Encoding"
    body = Zlib::GzipReader.new(StringIO.new(response.body)).read
    assert JSON.parse(body).key?("resources")
  end

  test "responses are plain for clients that do not accept gzip" do
    get "/api/resources"
    assert_response :success
    assert_nil response.headers["Content-Encoding"]
    assert JSON.parse(response.body).key?("resources")
  end

  test "CORS headers are still set on compressed responses" do
    get "/api/resources", headers: { "Accept-Encoding" => "gzip", "Origin" => "http://localhost:5173" }
    assert_equal "gzip", response.headers["Content-Encoding"]
    assert_equal "http://localhost:5173", response.headers["Access-Control-Allow-Origin"]
  end
end
