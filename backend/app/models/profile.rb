class Profile < ApplicationRecord
  self.primary_key = :user_id
  belongs_to :user

  JSON_FIELDS = %i[skills genres instruments languages credits open_to roles gear software event_types].freeze
  JSON_FIELDS.each { |field| attribute field, :json, default: -> { [] } }
  validates :website, :portfolio_url, :company_website, :photo_url, safe_http_url: true, allow_blank: true

  # Limits the web forms show as counters. Checked only when a value changes, so older rows
  # that predate a limit can still be saved while the user edits something else.
  TEXT_LIMITS = {
    headline: 160, bio: 2_000, location: 120, phone: 20, website: 500, portfolio_url: 500, experience: 60,
    availability: 120, photo_url: 500, company_name: 120, company_website: 500, company_size: 60, company_description: 2_000
  }.freeze
  PHONE_FORMAT = /\A\+?[\d\s().-]+\z/
  PHONE_MESSAGE = "must be a phone number with 7 to 15 digits, for example +91 98765 43210".freeze

  normalizes(*TEXT_LIMITS.keys, with: ->(value) { value.to_s.strip })
  TEXT_LIMITS.each do |field, maximum|
    validates field, length: { maximum: }, if: :"#{field}_changed?"
  end
  validate :phone_is_a_number, if: -> { phone.present? && phone_changed? }

  # Granular opt-outs shown on the "Manage emails" page (linked from every lifecycle,
  # digest and milestone email's footer). `email_notifications` is the master switch and
  # always wins; these only ever narrow what it already allows through.
  EMAIL_PREFERENCE_CATEGORIES = %w[digest lifecycle requests product].freeze

  # "Email me when payments open": kept beside the category toggles in email_preferences, but it is
  # not a category (it defaults to off, and no digest or lifecycle rule reads it). The owner can
  # query it: Profile.where("email_preferences ->> 'paymentsNotify' = 'true'").
  PAYMENTS_NOTIFY_KEY = "paymentsNotify".freeze

  def payments_notify? = email_preferences.to_h[PAYMENTS_NOTIFY_KEY] == true

  def api_json
    attributes.except("user_id", "created_at", "updated_at", "email_notifications").transform_keys { _1.camelize(:lower) }
  end

  # True when the master switch is on and this category hasn't been turned off. A hash
  # missing the key (an old row, or one built by hand) defaults that category to opted in.
  def email_category_enabled?(category)
    email_notifications? && email_preferences.to_h.fetch(category.to_s, true) != false
  end

  private

  def phone_is_a_number
    digits = phone.count("0-9")
    errors.add(:phone, PHONE_MESSAGE) unless phone.match?(PHONE_FORMAT) && digits.between?(7, 15)
  end
end
