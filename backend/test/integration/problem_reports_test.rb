require "test_helper"
require "minitest/mock"

# POST /api/problem-reports (ProblemReportsController) and the admin "Problem reports" tab
# (Admin::ProblemReportsController): auth, signed-out path, rate limits, screenshot validation,
# context and page sanitising, admin-only list/detail/screenshot, audit log, founder email.
class ProblemReportsTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  PNG = ("\x89PNG\r\n\x1A\n".b + ("\0".b * 64)).freeze

  setup do
    @seq = 0
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @env = ENV.to_h.slice("FOUNDER_REPORT_TO", "ADMIN_EMAIL", "EMAIL_DELIVERY_WEBHOOK", "FRONTEND_URL", "ADMIN_ORIGIN")
    %w[FOUNDER_REPORT_TO ADMIN_EMAIL EMAIL_DELIVERY_WEBHOOK ADMIN_ORIGIN].each { ENV.delete(_1) }
    @musician = create_user("Asha Rao", "jobseeker")
    @admin = create_user("Founder", "admin")
  end

  teardown do
    Rails.cache = @original_cache
    %w[FOUNDER_REPORT_TO ADMIN_EMAIL EMAIL_DELIVERY_WEBHOOK FRONTEND_URL ADMIN_ORIGIN].each { @env.key?(_1) ? ENV[_1] = @env[_1] : ENV.delete(_1) }
  end

  def create_user(name, role)
    @seq += 1
    User.create!(name:, email: "problem-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role:, status: "active",
      profile_complete: true).tap { _1.create_profile! }
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end

  def image(bytes = PNG, name: "shot.png", type: "image/png")
    file = Tempfile.new(["shot", File.extname(name)], binmode: true)
    file.write(bytes)
    file.rewind
    Rack::Test::UploadedFile.new(file.path, type, true, original_filename: name)
  end

  def submit(params = {}, headers: {})
    post "/api/problem-reports", params: { description: "The page froze when I saved." }.merge(params), headers:
  end

  # --- Signed in ---

  test "a signed-in person can send a report with context and no email" do
    context = { release: "abc123", browser: "Chrome 130", os: "Android 14", viewport: { width: 390, height: 844 }, errors: ["TypeError: x is undefined"] }.to_json
    assert_difference -> { ProblemReport.count }, 1 do
      submit({ expected: "It should save.", page: "/jobseeker/profile", context: }, headers: auth(@musician))
    end
    assert_response :created
    report = ProblemReport.find(response.parsed_body["id"])
    assert_equal @musician.id, report.user_id
    assert_nil report.email
    assert_equal "new", report.status
    assert_equal "It should save.", report.expected
    assert_equal "/jobseeker/profile", report.page
    assert_equal "jobseeker", report.context["role"], "the role comes from the server"
    assert_equal({ "width" => 390, "height" => 844 }, report.context["viewport"])
    assert_equal ["TypeError: x is undefined"], report.context["errors"]
    assert AuditLog.exists?(action: "problem_report.create", entity_id: report.id, actor_id: @musician.id)
  end

  test "an invalid token is treated as signed out and needs an email" do
    submit({}, headers: { "Authorization" => "Bearer nonsense" })
    assert_response :unprocessable_content
    assert_equal "EMAIL_REQUIRED", response.parsed_body["code"]
  end

  test "an inactive account is refused" do
    @musician.update!(status: "suspended")
    headers = auth(@musician)
    submit({}, headers:)
    assert_response :forbidden
    assert_equal 0, ProblemReport.count
  end

  test "what happened is required and bounded" do
    submit({ description: " " }, headers: auth(@musician))
    assert_response :unprocessable_content
    assert_equal "DESCRIPTION_REQUIRED", response.parsed_body["code"]

    submit({ description: "x" * (ProblemReport::DESCRIPTION_MAX + 1) }, headers: auth(@musician))
    assert_equal "DESCRIPTION_TOO_LONG", response.parsed_body["code"]

    submit({ expected: "x" * (ProblemReport::EXPECTED_MAX + 1) }, headers: auth(@musician))
    assert_equal "EXPECTED_TOO_LONG", response.parsed_body["code"]
    assert_equal 0, ProblemReport.count
  end

  test "excluding the context stores no page, no role and no errors" do
    submit({ page: "/jobseeker/profile", includeContext: "false", context: { release: "abc", errors: ["boom"] }.to_json }, headers: auth(@musician))
    assert_response :created
    report = ProblemReport.last
    assert_nil report.page
    assert_equal({}, report.context)
  end

  # --- Page and context sanitising ---

  test "the page keeps the path but drops token, code and other secret query parameters and the fragment" do
    cases = {
      "/reset-password?token=abc123&tab=security" => "/reset-password?tab=security",
      "https://musilynk.example/urgent/action?t=eyJhbGciOi&city=Mumbai#frag" => "/urgent/action?city=Mumbai",
      "/auth/callback?code=xyz&state=s&auth=google" => "/auth/callback",
      "/billing/cancel?access_token=1&Reset_Token=2&email=a%40b.in&q=drums" => "/billing/cancel?q=drums",
      "/join/musician?vouch=vch_abc&ref=friend" => "/join/musician?ref=friend",
      "/x/#{'a1' * 20}/profile" => "/x/:token/profile",
      "/opportunities/job_0f8e6c1a-2b4d-4c7e-9a31-5d6e7f8a9b0c" => "/opportunities/job_0f8e6c1a-2b4d-4c7e-9a31-5d6e7f8a9b0c"
    }
    cases.each do |input, expected|
      assert_equal expected, ProblemReport.sanitize_page(input), input
    end
    assert_nil ProblemReport.sanitize_page("")
  end

  test "token parameters in the submitted page never reach the database" do
    submit({ page: "/reset-password?token=SECRETVALUE&code=123456&t=SECRETVALUE2" }, headers: auth(@musician))
    assert_response :created
    report = ProblemReport.last
    assert_equal "/reset-password", report.page
    assert_no_match(/SECRET|123456/, report.attributes.to_json)
  end

  test "the context keeps only the allow-listed fields and scrubs emails and tokens from error messages" do
    context = {
      release: "r1", browser: "Chrome", os: "iOS", viewport: { width: 400, height: 800 },
      errors: Array.new(14) { |i| "Error #{i} for asha@example.com token=abcd1234 Bearer abc.def" },
      localStorage: { verse_access_token: "LEAK" }, formValues: { password: "LEAK" }, cookie: "LEAK"
    }.to_json
    submit({ context: }, headers: auth(@musician))
    stored = ProblemReport.last.context
    assert_equal %w[browser errors os release role viewport], stored.keys.sort
    assert_equal 10, stored["errors"].size
    assert_no_match(/asha@example|abcd1234|abc\.def|LEAK/, stored.to_json)
  end

  test "a malformed or oversized context is ignored, not an error" do
    submit({ context: "{not json" }, headers: auth(@musician))
    assert_response :created
    assert_equal({ "role" => "jobseeker" }, ProblemReport.last.context)
    submit({ context: { release: "x" * 20_000 }.to_json }, headers: auth(@musician))
    assert_response :created
    assert_equal({ "role" => "jobseeker" }, ProblemReport.last.context)
  end

  # --- Signed out ---

  test "a signed-out visitor must leave a valid email" do
    submit
    assert_response :unprocessable_content
    assert_equal "EMAIL_REQUIRED", response.parsed_body["code"]
    submit({ email: "not-an-email" })
    assert_equal "INVALID_EMAIL", response.parsed_body["code"]
    assert_equal 0, ProblemReport.count
  end

  test "a signed-out report is stored with the email and no user" do
    submit({ email: "Visitor@Example.com", page: "/pricing" })
    assert_response :created
    report = ProblemReport.last
    assert_nil report.user_id
    assert_equal "visitor@example.com", report.email
    assert_nil report.context["role"]
  end

  test "signed-out reports are limited per IP per hour" do
    ProblemReportsController::SIGNED_OUT_IP_PER_HOUR.times { |i| submit({ email: "v#{i}@example.com" }) && assert_response(:created) }
    submit({ email: "later@example.com" })
    assert_response :too_many_requests
    assert_equal ProblemReportsController::SIGNED_OUT_IP_PER_HOUR, ProblemReport.count
  end

  test "signed-out reports are limited per email address per day" do
    ProblemReportsController::SIGNED_OUT_EMAIL_PER_DAY.times do |i|
      submit({ email: "same@example.com" }, headers: { "REMOTE_ADDR" => "10.0.0.#{i + 1}" })
      assert_response :created
    end
    submit({ email: "same@example.com" }, headers: { "REMOTE_ADDR" => "10.0.9.9" })
    assert_response :too_many_requests
  end

  test "a signed-out site-wide daily cap protects the inbox" do
    stub_const(ProblemReportsController, :SIGNED_OUT_SITE_PER_DAY, 2) do
      3.times { |i| submit({ email: "cap#{i}@example.com" }, headers: { "REMOTE_ADDR" => "10.1.0.#{i + 1}" }) }
    end
    assert_response :too_many_requests
    assert_equal 2, ProblemReport.count
  end

  test "a filled honeypot is answered like a success but stores nothing" do
    submit({ email: "bot@example.com", website: "http://spam.example" })
    assert_response :created
    assert_equal 0, ProblemReport.count
  end

  test "signed-in people are limited per hour" do
    headers = auth(@musician)
    ProblemReportsController::SIGNED_IN_PER_HOUR.times { submit({}, headers:) && assert_response(:created) }
    submit({}, headers:)
    assert_response :too_many_requests
    assert_equal "RATE_LIMITED", response.parsed_body["code"]
  end

  # --- Screenshot ---

  test "a PNG screenshot is stored and linked to the report" do
    submit({ screenshot: image }, headers: auth(@musician))
    assert_response :created
    assert response.parsed_body["screenshotSaved"]
    report = ProblemReport.last
    assert report.screenshot?
    assert_equal "image/png", report.screenshot_blob.content_type
    assert_equal PNG, report.screenshot_blob.download
  end

  test "a file whose bytes are not an image is refused whatever its name or declared type" do
    submit({ screenshot: image("<html><script>alert(1)</script></html>", name: "shot.png", type: "image/png") }, headers: auth(@musician))
    assert_response :unprocessable_content
    assert_equal "INVALID_SCREENSHOT", response.parsed_body["code"]
    submit({ screenshot: image("%PDF-1.7\n".b + "0".b * 40, name: "shot.png", type: "image/png") }, headers: auth(@musician))
    assert_response :unprocessable_content
    submit({ screenshot: image("ID3".b + "0".b * 40, name: "shot.jpg", type: "image/jpeg") }, headers: auth(@musician))
    assert_response :unprocessable_content
    assert_equal 0, ProblemReport.count
    assert_equal 0, ActiveStorage::Blob.count
  end

  test "an oversized or empty screenshot is refused" do
    submit({ screenshot: image(PNG + ("0".b * ProblemReportsController::SCREENSHOT_MAX)) }, headers: auth(@musician))
    assert_response :unprocessable_content
    assert_match(/too large/, response.parsed_body["error"])
    submit({ screenshot: image("".b) }, headers: auth(@musician))
    assert_response :unprocessable_content
    assert_equal 0, ProblemReport.count
  end

  test "a screenshot field that is not a file is refused" do
    submit({ screenshot: "data:image/png;base64,AAAA" }, headers: auth(@musician))
    assert_response :unprocessable_content
    assert_equal "INVALID_SCREENSHOT", response.parsed_body["code"]
  end

  test "when no durable storage is configured the report is kept without the screenshot" do
    UploadStorage.stub(:ready?, false) do
      submit({ screenshot: image }, headers: auth(@musician))
    end
    assert_response :created
    assert_equal false, response.parsed_body["screenshotSaved"]
    assert_not ProblemReport.last.screenshot?
  end

  test "the report body limit allows a screenshot but not an oversized request" do
    submit({ screenshot: image }, headers: auth(@musician))
    assert_response :created
    post "/api/problem-reports", params: { description: "x", padding: "0" * (6 * 1024 * 1024) }, headers: auth(@musician)
    assert_response :content_too_large
  end

  # --- Founder email ---

  test "the founder is emailed a link to the admin console, with no report text, when FOUNDER_REPORT_TO is set" do
    ENV["EMAIL_DELIVERY_WEBHOOK"] = "https://email-hook.example.invalid/send"
    ENV["FOUNDER_REPORT_TO"] = "founder@example.com, second@example.com"
    ENV["FRONTEND_URL"] = "https://musilynk.example"
    assert_enqueued_jobs 2, only: EmailDeliveryJob do
      submit({ description: "My secret complaint" }, headers: auth(@musician))
    end
    assert_response :created
    sealed = enqueued_jobs.map { _1["arguments"].inspect }.join
    assert_no_match(/secret complaint/, sealed)
    link = ProblemReportNotifier.link(ProblemReport.last)
    assert_match %r{\Ahttps://musilynk\.example/admin\?tab=problems&report=prob_}, link
  end

  test "ADMIN_EMAIL is the fallback and nothing is sent, silently, when neither is set" do
    ENV["EMAIL_DELIVERY_WEBHOOK"] = "https://email-hook.example.invalid/send"
    ENV["ADMIN_EMAIL"] = "owner@example.com"
    assert_enqueued_jobs 1, only: EmailDeliveryJob do
      submit({}, headers: auth(@musician))
    end
    ENV.delete("ADMIN_EMAIL")
    assert_no_enqueued_jobs only: EmailDeliveryJob do
      submit({}, headers: auth(@musician))
    end
    assert_response :created
  end

  test "no email is sent when no provider is configured" do
    ENV["FOUNDER_REPORT_TO"] = "founder@example.com"
    assert_no_enqueued_jobs only: EmailDeliveryJob do
      submit({}, headers: auth(@musician))
    end
    assert_response :created
  end

  # --- Admin ---

  test "the admin endpoints are admin-only" do
    report = ProblemReport.create!(user: @musician, description: "Broken", screenshot_blob: stored_blob)
    paths = [[:get, "/api/admin/problem-reports"], [:get, "/api/admin/problem-reports/#{report.id}"],
      [:patch, "/api/admin/problem-reports/#{report.id}"], [:get, "/api/admin/problem-reports/#{report.id}/screenshot"]]
    paths.each do |verb, path|
      send(verb, path, params: { status: "triaged" })
      assert_response :unauthorized, "#{verb} #{path} anonymous"
      send(verb, path, params: { status: "triaged" }, headers: auth(@musician))
      assert_response :forbidden, "#{verb} #{path} as a musician"
    end
    assert_equal "new", report.reload.status
  end

  test "the admin list filters by status, pages and counts" do
    ProblemReport.create!(user: @musician, description: "One")
    ProblemReport.create!(user: @musician, description: "Two", status: "triaged")
    ProblemReport.create!(email: "v@example.com", description: "Three", status: "resolved")

    get "/api/admin/problem-reports", headers: auth(@admin)
    assert_response :success
    body = response.parsed_body
    assert_equal 3, body["total"]
    assert_equal({ "new" => 1, "triaged" => 1, "resolved" => 1 }, body["counts"])

    get "/api/admin/problem-reports?status=triaged", headers: auth(@admin)
    assert_equal ["Two"], response.parsed_body["reports"].map { _1["description"] }

    get "/api/admin/problem-reports?perPage=1&page=2", headers: auth(@admin)
    assert_equal 1, response.parsed_body["reports"].size
    assert_equal 3, response.parsed_body["total"]

    get "/api/admin/problem-reports?status=bogus", headers: auth(@admin)
    assert_equal 3, response.parsed_body["total"], "an unknown status is ignored"
  end

  test "the admin detail shows who sent it, and never includes the screenshot itself" do
    report = ProblemReport.create!(user: @musician, description: "Broken", page: "/pricing", context: { "release" => "r1" }, screenshot_blob: stored_blob)
    get "/api/admin/problem-reports/#{report.id}", headers: auth(@admin)
    assert_response :success
    body = response.parsed_body["report"]
    assert_equal true, body["hasScreenshot"]
    assert_equal @musician.email, body.dig("user", "email")
    assert_no_match(/blob|url|key/i, body.keys.join(","))
    get "/api/admin/problem-reports/prob_missing", headers: auth(@admin)
    assert_response :not_found
  end

  test "an admin changes status and adds a note, and each change is audit-logged" do
    report = ProblemReport.create!(user: @musician, description: "Broken")
    patch "/api/admin/problem-reports/#{report.id}", params: { status: "triaged", adminNote: "Looking into it" }, headers: auth(@admin), as: :json
    assert_response :success
    report.reload
    assert_equal "triaged", report.status
    assert_equal "Looking into it", report.admin_note
    assert_equal @admin.id, report.handled_by_id
    assert report.handled_at
    status_log = AuditLog.find_by!(action: "admin.problem_report.status", entity_id: report.id)
    assert_equal({ "from" => "new", "to" => "triaged" }, status_log.metadata)
    assert AuditLog.exists?(action: "admin.problem_report.note", entity_id: report.id)

    patch "/api/admin/problem-reports/#{report.id}", params: { status: "triaged" }, headers: auth(@admin), as: :json
    assert_equal 1, AuditLog.where(action: "admin.problem_report.status", entity_id: report.id).count, "an unchanged status is not logged again"
  end

  test "invalid status or note is refused" do
    report = ProblemReport.create!(user: @musician, description: "Broken")
    patch "/api/admin/problem-reports/#{report.id}", params: { status: "deleted" }, headers: auth(@admin), as: :json
    assert_response :bad_request
    patch "/api/admin/problem-reports/#{report.id}", params: { adminNote: "x" * (ProblemReport::NOTE_MAX + 1) }, headers: auth(@admin), as: :json
    assert_response :unprocessable_content
    patch "/api/admin/problem-reports/#{report.id}", params: {}, headers: auth(@admin), as: :json
    assert_response :bad_request
    assert_equal "new", report.reload.status
  end

  test "an admin gets a short-lived signed screenshot link, and the view is audit-logged" do
    report = ProblemReport.create!(user: @musician, description: "Broken", screenshot_blob: stored_blob)
    travel_to Time.utc(2026, 10, 2, 9, 0) do
      get "/api/admin/problem-reports/#{report.id}/screenshot", headers: auth(@admin)
      assert_response :success
      body = response.parsed_body
      assert_equal "image/png", body["contentType"]
      assert_equal "no-store", response.headers["Cache-Control"]
      assert_in_delta (Time.utc(2026, 10, 2, 9, 5)).to_f, Time.zone.parse(body["expiresAt"]).to_f, 5
      assert_match %r{/rails/active_storage/disk/}, body["url"]

      # The link itself works while fresh and not after it expires.
      get body["url"]
      assert_response :success
      assert_equal PNG, response.body.b
      travel 6.minutes
      get body["url"]
      assert_response :not_found
    end
    assert AuditLog.exists?(action: "admin.problem_report.screenshot", entity_id: report.id, actor_id: @admin.id)
  end

  test "a report without a screenshot answers 404 for the screenshot link" do
    report = ProblemReport.create!(user: @musician, description: "Broken")
    get "/api/admin/problem-reports/#{report.id}/screenshot", headers: auth(@admin)
    assert_response :not_found
    assert_equal "NO_SCREENSHOT", response.parsed_body["code"]
  end

  test "deleting the account removes its reports and screenshots" do
    report = ProblemReport.create!(user: @musician, description: "Broken", screenshot_blob: stored_blob)
    blob_id = report.screenshot_blob_id
    @musician.destroy!
    assert_not ProblemReport.exists?(report.id)
    assert_not ActiveStorage::Blob.exists?(blob_id)
  end

  test "problem reports show up in the founder report counts" do
    ProblemReport.create!(user: @musician, description: "Broken page on Friday", created_at: Time.utc(2026, 9, 23, 6, 0))
    ProblemReport.create!(email: "v@example.com", description: "Resolved one", status: "resolved", handled_at: Time.utc(2026, 9, 24, 6, 0), created_at: Time.utc(2026, 9, 23, 7, 0))
    data = FounderReport.new(now: Time.utc(2026, 9, 28, 3, 30)).call
    assert_equal 2, data[:current][:problemReports]
    assert_equal 1, data[:waiting][:problemReports]
    assert_equal 1, data[:needsYou][:problemReportsTotal]
    assert_match(/problem report: Broken page/, data[:needsYou][:problemReports].first[:text])
    assert_match %r{tab=problems}, data[:links][:problems]
    mail = FounderReportMail.render(data, now: Time.utc(2026, 9, 28, 3, 30))
    assert_includes mail[:text], "Problem reports (new): 1 (0 a week ago)"
    assert_includes mail[:text], "New problem reports (1)"
  end

  private

  def stored_blob
    ActiveStorage::Blob.create_and_upload!(io: StringIO.new(PNG), filename: "shot.png", content_type: "image/png", identify: false, metadata: { analyzed: true })
  end

  def stub_const(klass, name, value)
    original = klass.const_get(name)
    klass.send(:remove_const, name)
    klass.const_set(name, value)
    yield
  ensure
    klass.send(:remove_const, name)
    klass.const_set(name, original)
  end
end
