# A "Report a problem" message from the app: what happened, what the person expected, the page
# and the context they agreed to attach, and an optional screenshot. Written by
# ProblemReportsController, read and triaged in the admin console (Admin::ProblemReportsController).
class ProblemReport < ApplicationRecord
  STATUSES = %w[new triaged resolved].freeze
  DESCRIPTION_MAX = 4_000
  EXPECTED_MAX = 2_000
  NOTE_MAX = 2_000
  PAGE_MAX = 300
  EMAIL_FORMAT = /\A[^@\s]+@[^@\s]+\.[^@\s]{2,}\z/

  belongs_to :user, optional: true
  belongs_to :handled_by, class_name: "User", optional: true
  belongs_to :screenshot_blob, class_name: "ActiveStorage::Blob", optional: true

  validates :description, presence: true, length: { maximum: DESCRIPTION_MAX }
  validates :expected, length: { maximum: EXPECTED_MAX }, allow_nil: true
  validates :admin_note, length: { maximum: NOTE_MAX }, allow_nil: true
  validates :page, length: { maximum: PAGE_MAX }, allow_nil: true
  validates :status, inclusion: { in: STATUSES }
  validates :email, format: { with: EMAIL_FORMAT }, length: { maximum: 254 }, allow_nil: true
  validates :email, presence: true, unless: :user_id?

  # Blob#purge also touches the variant table, which this schema does not have; remove the file and the row directly.
  after_destroy_commit do
    blob = screenshot_blob
    next unless blob

    blob.delete
    ActiveStorage::Blob.where(id: blob.id).delete_all
  end

  scope :unhandled, -> { where(status: "new") }

  def screenshot? = screenshot_blob_id.present?

  # Query parameters that carry a secret or identify a person are dropped from the page we keep.
  SENSITIVE_PARAM = /\A(t|k|s|sig|code|state|auth|ticket|otp|jwt)\z|token|secret|signature|password|passwd|email|key|session|credential|reset|invite|vouch|unsubscribe/i
  # A path segment that looks like a credential (long, mixed letters and digits) instead of a slug.
  CREDENTIAL_SEGMENT = /\A(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9_\-]{24,}\z/
  # Verse's own ids (job_<uuid>, a bare uuid) are not credentials and help us find the page.
  RECORD_ID = /\A([a-z]{2,6}_)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z/

  # The page path to store: path and harmless query parameters only, never a host, fragment,
  # token parameter or credential-looking segment. Accepts a full URL or a path.
  def self.sanitize_page(value)
    raw = value.to_s.strip
    return nil if raw.empty?

    uri = URI.parse(raw.start_with?("/") ? raw : raw.sub(%r{\A[a-z][a-z0-9+.-]*://[^/?#]*}i, ""))
    path = uri.path.to_s.split("/").map { |segment| segment.match?(CREDENTIAL_SEGMENT) && !segment.match?(RECORD_ID) ? ":token" : segment }.join("/")
    path = "/#{path}" unless path.start_with?("/")
    pairs = URI.decode_www_form(uri.query.to_s).reject { |name, _| name.match?(SENSITIVE_PARAM) }
    result = pairs.empty? ? path : "#{path}?#{URI.encode_www_form(pairs.first(8))}"
    result.first(PAGE_MAX)
  rescue URI::InvalidURIError, ArgumentError
    nil
  end
end
