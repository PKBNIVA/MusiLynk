class Profile < ApplicationRecord
  self.primary_key = :user_id
  belongs_to :user

  JSON_FIELDS = %i[skills genres instruments languages credits open_to roles gear software].freeze
  JSON_FIELDS.each { |field| attribute field, :json, default: -> { [] } }
  validates :website, :portfolio_url, :company_website, safe_http_url: true, allow_blank: true

  # Limits the web forms show as counters. Checked only when a value changes, so older rows
  # that predate a limit can still be saved while the user edits something else.
  TEXT_LIMITS = {
    headline: 160, bio: 2_000, location: 120, phone: 20, website: 500, portfolio_url: 500, experience: 60,
    availability: 120, company_name: 120, company_website: 500, company_size: 60, company_description: 2_000
  }.freeze
  PHONE_FORMAT = /\A\+?[\d\s().-]+\z/
  PHONE_MESSAGE = "must be a phone number with 7 to 15 digits, for example +91 98765 43210".freeze

  normalizes(*TEXT_LIMITS.keys, with: ->(value) { value.to_s.strip })
  TEXT_LIMITS.each do |field, maximum|
    validates field, length: { maximum: }, if: :"#{field}_changed?"
  end
  validate :phone_is_a_number, if: -> { phone.present? && phone_changed? }

  def api_json
    attributes.except("user_id", "created_at", "updated_at", "email_notifications").transform_keys { _1.camelize(:lower) }
  end

  private

  def phone_is_a_number
    digits = phone.count("0-9")
    errors.add(:phone, PHONE_MESSAGE) unless phone.match?(PHONE_FORMAT) && digits.between?(7, 15)
  end
end
