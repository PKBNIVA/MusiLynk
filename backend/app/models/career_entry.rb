# One fact in a person's career record: the single master copy that every resume draws on.
# `fields` holds the kind's own fields (see KINDS); start_on/end_on are the dates (a year or a
# month is stored as its first day); `tags` are free words that resume rules can select on.
class CareerEntry < ApplicationRecord
  # Field specs per kind: [type, maximum length, required?]. Dates are the start_on/end_on columns.
  KINDS = {
    "experience" => { "role" => [:text, 120, true], "organization" => [:text, 120], "location" => [:text, 120],
                      "current" => [:boolean], "description" => [:text, 2_000] },
    "credit" => { "title" => [:text, 160, true], "role" => [:text, 120], "artist" => [:text, 120], "year" => [:year], "url" => [:url] },
    "education" => { "institution" => [:text, 160, true], "qualification" => [:text, 160], "field" => [:text, 120] },
    "skill" => { "name" => [:text, 60, true], "level" => [:choice, %w[beginner intermediate advanced expert]] },
    "gear" => { "name" => [:text, 120, true], "notes" => [:text, 300] },
    "language" => { "name" => [:text, 60, true], "proficiency" => [:choice, %w[basic conversational fluent native]] },
    "link" => { "label" => [:text, 60], "url" => [:url, nil, true] },
    "award" => { "title" => [:text, 160, true], "issuer" => [:text, 120], "year" => [:year], "url" => [:url] }
  }.freeze
  YEARS = 1900..2100
  MAX_PER_USER = 300
  MAX_TAGS = 20

  belongs_to :user
  attribute :fields, :json, default: -> { {} }
  attribute :tags, :json, default: -> { [] }

  validates :kind, inclusion: { in: KINDS.keys }
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0, less_than: 100_000 }
  validate :fields_match_kind
  validate :tags_are_short_strings
  validate :dates_are_ordered

  after_commit -> { ShowcaseSync.entry(self) }, on: %i[create update]
  after_destroy_commit -> { ShowcaseSync.forget_entry(id) }

  # The entry's title as a resume line shows it.
  def label = fields.values_at("role", "title", "institution", "name", "label").compact.first || kind

  def year = start_on&.year || fields["year"]

  def facets = { "kinds" => [kind], "tags" => Array(tags) }

  # All of the entry's words, for matching rule tags against text.
  def text = [fields.values.grep(String), tags].flatten.join(" \n ")

  def api_json
    { id:, kind:, fields:, startOn: start_on, endOn: end_on, tags:, position:, createdAt: created_at, updatedAt: updated_at }
  end

  private

  def fields_match_kind
    spec = KINDS[kind]
    return unless spec
    return errors.add(:fields, "must be an object") unless fields.is_a?(Hash)
    unknown = fields.keys - spec.keys
    return errors.add(:fields, "has unknown fields for #{kind}: #{unknown.join(', ')} (use #{spec.keys.join(', ')})") if unknown.any?
    spec.each do |field, (type, limit, required)|
      value = fields[field]
      if value.nil? || value == ""
        errors.add(:fields, "#{field} is required for #{kind}") if required
        next
      end
      message = field_error(type, value, limit)
      errors.add(:fields, "#{field} #{message}") if message
    end
  end

  def field_error(type, value, limit)
    case type
    when :text then "must be text of up to #{limit} characters" unless value.is_a?(String) && value.length <= limit
    when :year then "must be a year from #{YEARS.first} to #{YEARS.last}" unless value.is_a?(Integer) && YEARS.cover?(value)
    when :boolean then "must be true or false" unless [true, false].include?(value)
    when :choice then "must be one of: #{limit.join(', ')}" unless limit.include?(value)
    when :url then "must be an HTTPS link of up to 500 characters" unless https_url?(value)
    end
  end

  def https_url?(value)
    return false unless value.is_a?(String) && value.length <= 500
    uri = URI.parse(value)
    uri.scheme&.downcase == "https" && uri.host.present? && uri.userinfo.blank?
  rescue URI::InvalidURIError
    false
  end

  def tags_are_short_strings
    valid = tags.is_a?(Array) && tags.length <= MAX_TAGS && tags.all? { _1.is_a?(String) && _1.strip.length.between?(1, 40) }
    errors.add(:tags, "must be a list of up to #{MAX_TAGS} words of up to 40 characters") unless valid
  end

  def dates_are_ordered
    errors.add(:end_on, "must not be before the start") if start_on && end_on && end_on < start_on
    [start_on, end_on].compact.each { errors.add(:start_on, "must be between #{YEARS.first} and #{YEARS.last}") unless YEARS.cover?(_1.year) }
  end
end
