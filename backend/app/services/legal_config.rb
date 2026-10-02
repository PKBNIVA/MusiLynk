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

  # --- Invoice seller details (TaxInvoiceGenerator, the invoice page, the admin warning) ---

  def self.gst_registered? = business[:gst_registered] == true
  # A missing flag means prices include GST, which is how the plan prices are quoted today.
  def self.prices_include_gst? = business[:prices_include_gst] != false
  def self.sac_code = business[:sac_code].to_s.strip
  def self.invoice_prefix = business[:invoice_prefix].to_s.strip.presence || "VRS"

  # The seller's two-digit GST state code: the configured one, else the GSTIN's, else looked up
  # from the state name. nil while none of these is filled in.
  def self.seller_state_code
    configured = business[:state_code].to_s.strip
    return configured if IndianStates.valid?(configured)
    return Gstin.state_code(gstin) if Gstin.valid?(gstin) && configured?(gstin)

    IndianStates.code_for_name(business_state) if configured?(business_state)
  end

  # Fields still to be filled before an invoice may be issued, as "business.<key>".
  def self.invoice_pending_fields
    pending = []
    pending << "business.legal_name" unless configured?(legal_name)
    pending << "business.address" unless configured?(business_address)
    pending << "business.state_code" unless seller_state_code
    pending << "business.pan" unless configured?(business[:pan])
    pending << "business.sac_code" unless configured?(sac_code)
    pending << "business.gstin" if gst_registered? && !Gstin.valid?(gstin)
    pending
  end

  def self.invoice_seller_pending? = invoice_pending_fields.any?

  # The seller block copied onto each invoice when it is issued. Placeholders and a missing GSTIN
  # come out blank, never invented.
  def self.invoice_seller
    value = ->(raw) { configured?(raw) ? raw.to_s.strip : "" }
    { legalName: value[legal_name], address: value[business_address], state: seller_state_code ? IndianStates.name(seller_state_code) : "",
      stateCode: seller_state_code.to_s, gstin: gst_registered? ? Gstin.normalize(gstin) : "", pan: value[business[:pan]],
      sacCode: sac_code, gstRegistered: gst_registered?, pricesIncludeGst: prices_include_gst?, pending: invoice_seller_pending? }
  end
end
