# Loads config/legal.yml once per process (same pattern as AiPricing/BookingFeePolicy).
# Every field here is a compliance placeholder for a lawyer/CA and the business owner to fill in;
# nothing is invented, and a blank GSTIN is a signal to hide GST fields on a generated invoice.
class LegalConfig
  CONFIG_PATH = Rails.root.join("config/legal.yml")

  def self.config
    @config ||= YAML.safe_load(File.read(CONFIG_PATH), aliases: true).fetch(Rails.env, {}).deep_symbolize_keys
  end

  def self.reload! = @config = nil

  def self.business = config.fetch(:business, {})
  def self.grievance_officer = config.fetch(:grievance_officer, {})
  def self.legal_name = business[:legal_name].to_s
  def self.gstin = business[:gstin].to_s
  def self.gstin_present? = gstin.strip.present?
  def self.business_address = business[:address].to_s
  def self.business_state = business[:state].to_s

  PLACEHOLDER = /\A\[.*\]\z/m
  # Fields a lawyer/CA still has to fill in, as "section.key". GSTIN is deliberately absent:
  # it stays blank until the business is GST-registered.
  REQUIRED_FIELDS = %w[business.legal_name business.address business.state
    grievance_officer.name grievance_officer.email grievance_officer.address].freeze

  # A value counts as filled in once it is non-blank and no longer a "[PLACEHOLDER]".
  def self.configured?(value) = value.to_s.strip.present? && !value.to_s.strip.match?(PLACEHOLDER)

  def self.field(path)
    section, key = path.split(".")
    config.dig(section.to_sym, key.to_sym)
  end

  # Names (e.g. "grievance_officer.email") of the required fields that are still placeholders.
  def self.unfilled_fields = REQUIRED_FIELDS.reject { configured?(field(_1)) }

  # Safe to expose to the public site: business identity and the grievance officer block for the
  # Privacy Policy's DPDP section. Never includes anything more sensitive than what already
  # appears on an invoice or the Terms/Privacy pages. A value that is still a "[PLACEHOLDER]" is
  # served as an empty string, and `configured` says per field whether the real value is in.
  def self.public_json
    value = ->(path) { configured?(field(path)) ? field(path).to_s : "" }
    flag = ->(path) { configured?(field(path)) }
    { legalName: value["business.legal_name"], gstin: gstin, gstinPresent: gstin_present?, businessAddress: value["business.address"],
      businessState: value["business.state"],
      grievanceOfficer: { name: value["grievance_officer.name"], email: value["grievance_officer.email"], address: value["grievance_officer.address"] },
      configured: { legalName: flag["business.legal_name"], businessAddress: flag["business.address"], businessState: flag["business.state"],
                    grievanceOfficer: { name: flag["grievance_officer.name"], email: flag["grievance_officer.email"], address: flag["grievance_officer.address"] } } }
  end
end
