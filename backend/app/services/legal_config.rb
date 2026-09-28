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

  # Safe to expose to the public site: business identity and the grievance officer block for the
  # Privacy Policy's DPDP section. Never includes anything more sensitive than what already
  # appears on an invoice or the Terms/Privacy pages.
  def self.public_json
    { legalName: legal_name, gstin: gstin, gstinPresent: gstin_present?, businessAddress: business_address,
      businessState: business_state, grievanceOfficer: { name: grievance_officer[:name].to_s, email: grievance_officer[:email].to_s, address: grievance_officer[:address].to_s } }
  end
end
