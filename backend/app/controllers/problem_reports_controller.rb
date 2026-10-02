# POST /api/problem-reports: the in-app "Report a problem" dialog. Open to signed-out visitors too
# (they must leave an email), so it is the one public endpoint that accepts a file. Guards:
# per-IP and per-address rate limits, a site-wide daily cap for signed-out reports, a hidden
# honeypot field, a 4 MB image-only screenshot checked by magic bytes (MediaTypeSniffer, the
# same sniffing the library uploads use), and an allow-list for the attached context.
class ProblemReportsController < ApplicationController
  include UserRateLimit

  SCREENSHOT_TYPES = %w[image/png image/jpeg image/webp].freeze
  SCREENSHOT_MAX = 4.megabytes
  SIGNED_IN_PER_HOUR = 10
  SIGNED_IN_IP_PER_HOUR = 40
  SIGNED_OUT_IP_PER_HOUR = 3
  SIGNED_OUT_IP_PER_DAY = 8
  SIGNED_OUT_EMAIL_PER_DAY = 3
  SIGNED_OUT_SITE_PER_DAY = 100

  def create
    return unless authenticate_if_present
    return unless within_limits?

    # A bot filled the hidden field: answer like a success, store nothing.
    return render json: { id: "prb_received", screenshotSaved: false }, status: :created if params[:website].present?

    description = text_param(:description)
    return invalid("Tell us what happened.", "DESCRIPTION_REQUIRED") if description.blank?
    return invalid("What happened is too long. Keep it under #{ProblemReport::DESCRIPTION_MAX} characters.", "DESCRIPTION_TOO_LONG") if description.length > ProblemReport::DESCRIPTION_MAX

    expected = text_param(:expected)
    return invalid("What you expected is too long. Keep it under #{ProblemReport::EXPECTED_MAX} characters.", "EXPECTED_TOO_LONG") if expected.to_s.length > ProblemReport::EXPECTED_MAX

    email = text_param(:email)&.downcase
    if current_user.nil?
      return invalid("Add your email so we can reply.", "EMAIL_REQUIRED") if email.blank?
      return invalid("That email address does not look right.", "INVALID_EMAIL") unless email.match?(ProblemReport::EMAIL_FORMAT) && email.length <= 254
      return unless within_email_limit?(email)
    end

    upload = params[:screenshot]
    content_type = nil
    if upload.present?
      return invalid("Attach the screenshot as an image file.", "INVALID_SCREENSHOT") unless upload.respond_to?(:tempfile)

      content_type, problem = check_screenshot(upload)
      return invalid(problem, "INVALID_SCREENSHOT") if problem
    end

    include_context = params[:includeContext].to_s != "false"
    report = ProblemReport.new(user: current_user, email: (email if current_user.nil?), description:, expected: expected.presence,
      page: (ProblemReport.sanitize_page(params[:page]) if include_context),
      context: include_context ? ProblemReportContext.build(params[:context], role: current_user&.role) : {})
    saved = attach_screenshot(report, upload, content_type) if content_type
    begin
      report.save!
    rescue StandardError
      # The blob is created before the report; don't leave the file orphaned when the report is not saved.
      discard_blob(report.screenshot_blob)
      raise
    end
    audit!("problem_report.create", report) if current_user
    ProblemReportNotifier.notify(report)
    render json: { id: report.id, screenshotSaved: saved == true }, status: :created
  end

  private

  def authenticate_if_present
    return true if request.authorization.blank? || current_user.nil?

    authenticate!
  end

  def within_limits?
    if current_user
      return false unless throttle!("problem-report-ip", limit: SIGNED_IN_IP_PER_HOUR, period: 1.hour)

      within_user_rate_limit?("problem-report", limit: SIGNED_IN_PER_HOUR, period: 1.hour)
    else
      throttle!("problem-report-ip", limit: SIGNED_OUT_IP_PER_HOUR, period: 1.hour) &&
        throttle!("problem-report-ip-day", limit: SIGNED_OUT_IP_PER_DAY, period: 1.day) &&
        within_site_limit?
    end
  end

  def within_site_limit?
    count = Rails.cache.increment("rate:problem-report-site:#{Time.current.to_i / 1.day.to_i}", 1, expires_in: 1.day)
    return true if count.nil? || count <= SIGNED_OUT_SITE_PER_DAY

    render_too_many_requests
    false
  end

  def within_email_limit?(email)
    count = Rails.cache.increment("rate:problem-report-email:#{digest(email)}:#{Time.current.to_i / 1.day.to_i}", 1, expires_in: 1.day)
    return true if count.nil? || count <= SIGNED_OUT_EMAIL_PER_DAY

    render_too_many_requests
    false
  end

  def text_param(key)
    value = params[key]
    value.is_a?(String) ? value.strip.presence : nil
  end

  def invalid(message, code)
    render_error(message, :unprocessable_content, code)
    nil
  end

  # => [sniffed content type, nil] for an acceptable image, or [nil, message]. The declared type and
  # the file name are never trusted: only the leading bytes decide.
  def check_screenshot(upload)
    size = upload.size.to_i
    return [nil, "The screenshot is empty."] if size.zero?
    return [nil, "The screenshot is too large. Keep it under #{SCREENSHOT_MAX / 1.megabyte} MB."] if size > SCREENSHOT_MAX

    upload.tempfile.rewind
    detected = MediaTypeSniffer.detect(upload.tempfile.read(MediaTypeSniffer::HEADER_BYTES))
    upload.tempfile.rewind
    SCREENSHOT_TYPES.include?(detected) ? [detected, nil] : [nil, "The screenshot must be a PNG, JPEG or WebP image."]
  end

  def discard_blob(blob)
    return unless blob

    blob.delete
    ActiveStorage::Blob.where(id: blob.id).delete_all
  rescue StandardError => error
    ErrorReporter.capture(error, tags: { source: "problem_report_blob_cleanup" })
  end

  # Stores the image when there is somewhere durable to put it; the report is kept either way.
  def attach_screenshot(report, upload, content_type)
    return false unless UploadStorage.ready?

    extension = { "image/png" => "png", "image/jpeg" => "jpg", "image/webp" => "webp" }.fetch(content_type)
    report.screenshot_blob = ActiveStorage::Blob.create_and_upload!(io: upload.tempfile, filename: "problem-report-#{SecureRandom.hex(6)}.#{extension}",
      content_type:, identify: false, metadata: { analyzed: true })
    true
  rescue StandardError => error
    ErrorReporter.capture(error, tags: { source: "problem_report_screenshot" })
    false
  end
end
