# Swaps config/legal.yml's business block for a test, and puts the real file back afterwards.
module SellerConfig
  FILLED = {
    legal_name: "Alien Brains Private Limited", gstin: "27AAPFU0939F1ZV", address: "12 Linking Road, Bandra West, Mumbai 400050", state: "Maharashtra",
    state_code: "27", pan: "AAPFU0939F", sac_code: "998314", gst_registered: true, prices_include_gst: true, invoice_prefix: "VRS"
  }.freeze

  def with_seller(**overrides)
    LegalConfig.instance_variable_set(:@config, { business: FILLED.merge(overrides), grievance_officer: {} })
    yield
  ensure
    LegalConfig.reload!
  end

  def use_seller(**overrides)
    LegalConfig.instance_variable_set(:@config, { business: FILLED.merge(overrides), grievance_officer: {} })
  end
end
