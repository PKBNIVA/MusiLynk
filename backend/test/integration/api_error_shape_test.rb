require "test_helper"
require_relative "../support/api_matrix_world"

# Error-shape consistency: every client mistake becomes a 4xx {error, code?} JSON body, never a
# 500 or a framework error page (which in development/test also carries stack traces).
class ApiErrorShapeTest < ActionDispatch::IntegrationTest
  include ApiMatrixAssertions

  class ProbeController < ApplicationController
    def parameter_missing = params.require(:needed)
    def bad_request = raise(ActionController::BadRequest, "Frequency must be daily")
    def not_unique = raise(ActiveRecord::RecordNotUnique, "duplicate key value violates unique constraint")
    # The message ActiveRecord::Enum raises for enums declared without `validate: true`
    # (today's User/Job enums validate instead, so the rescue is a guard for future enums).
    def enum_value = raise(ArgumentError, "'overlord' is not a valid role")
    def range = Job.new(slots: 10**20).tap { _1.save!(validate: false) }
    def programming_error = raise(ArgumentError, "wrong number of arguments (given 1, expected 0)")
    def json_body = render(json: { received: params[:payload] })
    def record_invalid = AvailabilityWindow.create!(user: User.first, start_at: 1.hour.from_now, end_at: 2.hours.ago, status: "nope")
    def field_errors = render_error("Fix the highlighted fields.", :unprocessable_content, "INVALID_PROFILE", fields: { "company_name" => "Company name is required.", phone: ["Phone is invalid", ""], "rates.hourly" => [] })
    def plain_error = render_error("Plain", :conflict, "PLAIN", fields: {})
  end

  setup do
    @world = ApiMatrixWorld.build
    @headers = @world.headers(:js)
  end

  test "probe: ParameterMissing is 400 PARAMETER_MISSING" do
    with_probe_routes do
      post "/probe/parameter_missing", params: {}, as: :json
      assert_error(400, "PARAMETER_MISSING")
      assert_equal "Missing parameter: needed", response.parsed_body["error"]
    end
  end

  test "probe: BadRequest keeps its message and is 400 BAD_REQUEST" do
    with_probe_routes do
      post "/probe/bad_request", as: :json
      assert_error(400, "BAD_REQUEST")
      assert_equal "Frequency must be daily", response.parsed_body["error"]
    end
  end

  test "probe: RecordNotUnique is 409 CONFLICT" do
    with_probe_routes do
      post "/probe/not_unique", as: :json
      assert_error(409, "CONFLICT")
      assert_not_includes response.body, "duplicate key", "database text must not leak"
    end
  end

  test "probe: invalid enum assignment is 422 INVALID_VALUE" do
    with_probe_routes do
      post "/probe/enum_value", as: :json
      assert_error(422, "INVALID_VALUE")
      assert_match(/overlord is not a valid role/i, response.parsed_body["error"])
    end
  end

  test "probe: integer overflow is 422 OUT_OF_RANGE" do
    with_probe_routes do
      post "/probe/range", as: :json
      assert_error(422, "OUT_OF_RANGE")
    end
  end

  test "probe: unrelated ArgumentError stays a server error" do
    with_probe_routes do
      post "/probe/programming_error", as: :json
      assert_equal 500, response.status
    end
  end

  test "probe: malformed JSON is 400 MALFORMED_JSON" do
    with_probe_routes do
      post "/probe/json_body", params: '{"payload": ', headers: { "CONTENT_TYPE" => "application/json" }
      assert_error(400, "MALFORMED_JSON")
    end
  end

  test "probe: RecordInvalid lists each invalid attribute under fields, camelCased, with full messages" do
    with_probe_routes do
      post "/probe/record_invalid", as: :json
      assert_error(422, "VALIDATION_FAILED")
      body = response.parsed_body
      assert_match(/End at must be after the start/, body["error"], "the sentence stays for older clients")
      assert_equal ["End at must be after the start"], body["fields"]["endAt"]
      assert_equal ["Status must be one of available, hold, tentative, booked, unavailable"], body["fields"]["status"]
      assert_equal %w[endAt status], body["fields"].keys.sort
    end
  end

  test "probe: render_error fields are normalised; empty fields are omitted" do
    with_probe_routes do
      post "/probe/field_errors", as: :json
      assert_error(422, "INVALID_PROFILE")
      assert_equal({ "companyName" => ["Company name is required."], "phone" => ["Phone is invalid"] }, response.parsed_body["fields"])
      post "/probe/plain_error", as: :json
      assert_error(409, "PLAIN")
      assert_equal %w[code error], response.parsed_body.keys.sort, "no fields key when there are none"
    end
  end

  test "a real RecordInvalid endpoint returns fields next to the old sentence" do
    post "/api/availability", params: { startAt: 2.days.from_now.iso8601, endAt: 1.day.from_now.iso8601 }, headers: @headers, as: :json
    assert_error(422, "VALIDATION_FAILED")
    assert_kind_of String, response.parsed_body["error"]
    assert_includes response.parsed_body["fields"].keys, "endAt"
  end

  test "malformed JSON on real endpoints is 400 MALFORMED_JSON, never 500" do
    [[:post, "/api/jobs"], [:put, "/api/profile"], [:post, "/api/auth/login"], [:post, "/api/reports"], [:patch, "/api/job-alerts/#{@world.refs[:js][:alert]}"]].each do |verb, path|
      public_send(verb, path, params: '{"title": "unterminated', headers: @headers.merge("CONTENT_TYPE" => "application/json"))
      assert_error(400, "MALFORMED_JSON", "#{verb} #{path}")
    end
  end

  test "invalid job alert frequency is 422 INVALID_ALERT with its message and no trace" do
    post "/api/job-alerts", params: { name: "x", frequency: "hourly" }, headers: @headers, as: :json
    assert_error(422, "INVALID_ALERT")
    assert_equal "Frequency must be daily, weekly, or saved", response.parsed_body["error"]
  end

  test "omitted NOT NULL fields are 422 MISSING_FIELD naming the field" do
    # Talent folders and crew plans validate in the model: 422 VALIDATION_FAILED; see below.
    { "/api/band-projects" => "name" }.each do |path, field|
      post path, params: {}, headers: @world.headers(:emp), as: :json
      assert_error(422, "MISSING_FIELD", path)
      assert_equal "#{field} is required.", response.parsed_body["error"]
    end
    { "/api/talent-folders" => /Name can't be blank/, "/api/crew-plans" => /Title can't be blank/ }.each do |path, message|
      post path, params: {}, headers: @world.headers(:emp), as: :json
      assert_error(422, "VALIDATION_FAILED", path)
      assert_match message, response.parsed_body["error"]
    end
    post "/api/band-projects/#{@world.refs[:emp][:project]}/roles", params: {}, headers: @world.headers(:emp), as: :json
    assert_error(422, "MISSING_FIELD")
    assert_equal "roleName is required.", response.parsed_body["error"]
  end

  test "reports validate required fields, types and lengths" do
    post "/api/reports", params: {}, headers: @headers, as: :json
    assert_error(422, "INVALID_REPORT")
    assert_equal "entityType is required.", response.parsed_body["error"]
    post "/api/reports", params: { entityType: ["job"], entityId: "x", reason: "spam" }, headers: @headers, as: :json
    assert_error(422, "INVALID_REPORT")
    post "/api/reports", params: { entityType: "job", entityId: "x", reason: "r" * 201 }, headers: @headers, as: :json
    assert_error(422, "INVALID_REPORT")
    assert_no_difference -> { Report.count } do
      post "/api/reports", params: { entityType: "job", entityId: "x", reason: { "$ne" => "" } }, headers: @headers, as: :json
    end
    assert_error(422, "INVALID_REPORT")
    # :emp][:job] is not used here: the shared world already seeds an open report by :js on it
    # (see api_matrix_world.rb `report:`), which would otherwise trip the duplicate-report check.
    assert_difference -> { Report.count }, 1 do
      post "/api/reports", params: { entityType: "job", entityId: @world.refs[:emp][:draft_job], reason: "Asks for payment", details: "Details" }, headers: @headers, as: :json
    end
    assert_response :created
    report = Report.order(:created_at).last
    assert_equal [@world.user(:js).id, "open"], [report.reporter_id, report.status]
  end

  test "verification requests reject non-text and oversized evidence" do
    post "/api/verification-requests", params: { kind: "professional", evidenceUrl: ["https://a.example"] }, headers: @headers, as: :json
    assert_error(422, "INVALID_VERIFICATION_REQUEST")
    post "/api/verification-requests", params: { kind: "professional", note: "n" * 2_001 }, headers: @headers, as: :json
    assert_error(422, "INVALID_VERIFICATION_REQUEST")
    post "/api/verification-requests", params: { kind: "professional", evidenceUrl: "javascript:alert(1)" }, headers: @headers, as: :json
    assert_error(422, nil)
    post "/api/verification-requests", params: { kind: "professional", status: "approved", userId: @world.user(:js2).id, reviewedById: @world.user(:admin).id }, headers: @headers, as: :json
    assert_response :created
    record = VerificationRequest.find(response.parsed_body["id"])
    assert_equal ["pending", @world.user(:js).id, nil], [record.status, record.user_id, record.reviewed_by_id]
  end

  test "readiness answers 503 with the error shape but no diagnostics" do
    get "/api/readiness"
    if response.status == 503
      assert_error(503, "NOT_READY")
      assert_equal false, response.parsed_body["ok"]
    else
      assert_equal 200, response.status
      assert_nil response.parsed_body["error"]
    end
    assert_nil response.parsed_body["checks"]
  end

  private

  def assert_error(status, code, label = nil)
    assert_equal status, response.status, "#{label} #{response.body.first(300)}"
    assert_error_shape(label || request.path)
    assert_equal code, response.parsed_body["code"], label if code
  end

  def with_probe_routes(&)
    with_routing do |set|
      set.draw do
        %w[parameter_missing bad_request not_unique enum_value range programming_error json_body record_invalid field_errors plain_error].each do |action|
          post "/probe/#{action}", to: "api_error_shape_test/probe##{action}"
        end
      end
      yield
    end
  end
end
