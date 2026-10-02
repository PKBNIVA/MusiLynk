# Issues the one tax invoice (or bill of supply) for a paid Razorpay subscription charge. Called
# from the signed `subscription.charged` webhook, and again by TaxInvoiceCatchUpJob for charges
# that arrived while the seller details in config/legal.yml were still placeholders.
#
# Idempotent per Razorpay payment id: a retried webhook returns the invoice already on file. The
# amount is what Razorpay actually collected, in paise; the GST split is derived from it (see
# InvoiceTax), so the invoice total always equals the charge.
class TaxInvoiceGenerator
  SUPPORTED_PAYMENT_STATUSES = %w[captured refunded].freeze

  # `payment` is the Razorpay payment entity (a Hash) from the webhook payload.
  def self.for_charge(subscription:, payment:)
    return nil unless subscription && payment.is_a?(Hash)

    payment_id = payment["id"].to_s
    amount = payment["amount"].to_i
    return nil if payment_id.blank? || !amount.positive? || payment["currency"].to_s.upcase != "INR"
    return nil unless SUPPORTED_PAYMENT_STATUSES.include?(payment["status"].to_s)

    existing = TaxInvoice.find_by(provider_payment_id: payment_id)
    return existing if existing
    # Nothing is numbered against placeholder seller details in production; the catch-up job issues it once they are filled in.
    return nil if Rails.env.production? && LegalConfig.invoice_seller_pending?

    issue!(subscription:, payment_id:, amount:, payment:)
  rescue ActiveRecord::RecordNotUnique
    TaxInvoice.find_by(provider_payment_id: payment_id) || raise
  end

  # Issues invoices for charges recorded from webhooks that have none yet (oldest first, so the
  # numbers follow charge order). Returns how many were issued.
  def self.catch_up!(limit: 200)
    return 0 if Rails.env.production? && LegalConfig.invoice_seller_pending?

    issued = 0
    BillingEvent.where(event_type: "subscription.charged").where.not(user_id: nil)
      .where("NOT EXISTS (SELECT 1 FROM tax_invoices WHERE tax_invoices.provider_payment_id = billing_events.payload #>> '{payload,payment,entity,id}')")
      .order(:created_at).find_each do |event|
      payment = event.payload.is_a?(Hash) ? event.payload.dig("payload", "payment", "entity") : nil
      next unless payment.is_a?(Hash) && payment["id"].present?
      next if TaxInvoice.exists?(provider_payment_id: payment["id"])

      subscription = Subscription.find_by(provider_subscription_id: event.payload.dig("payload", "subscription", "entity", "id"))
      next unless subscription

      issued += 1 if for_charge(subscription:, payment:)
      break if issued >= limit
    end
    issued
  end

  def self.issue!(subscription:, payment_id:, amount:, payment:)
    user = subscription.user
    seller = LegalConfig.invoice_seller
    profile = BillingProfile.current_for(user)
    buyer = profile ? profile.snapshot : { type: "individual", name: user.name, gstin: "", pan: "", addressLine1: "", addressLine2: "", city: "", state: "",
                                           stateCode: "", postalCode: "", country: "India", email: user.email, poReference: "", profileVersion: nil }
    place_of_supply = buyer[:stateCode].presence || seller[:stateCode].presence
    tax = InvoiceTax.compute(amount_paise: amount, gst_registered: seller[:gstRegistered], prices_include_gst: seller[:pricesIncludeGst],
      seller_state_code: seller[:stateCode], place_of_supply_code: place_of_supply)
    issued_at = payment["created_at"].to_s.match?(/\A\d+\z/) ? Time.at(payment["created_at"].to_i).utc : Time.current
    financial_year = TaxInvoice.financial_year_at(issued_at)
    plan_name = Billing::BillingController::PLANS.dig(subscription.plan_code, :name) || subscription.plan_code.to_s.titleize
    line = { description: "Verse #{plan_name} plan, #{subscription.annual? ? 'annual' : 'monthly'} subscription", sacCode: seller[:sacCode],
             quantity: 1, taxableValuePaise: tax.taxable_paise,
             periodStart: subscription.current_period_start&.iso8601, periodEnd: subscription.current_period_end&.iso8601 }

    invoice = TaxInvoice.transaction(requires_new: true) do
      sequence = TaxInvoice.next_sequence!(LegalConfig.invoice_prefix, financial_year)
      TaxInvoice.create!(user:, subscription:, billing_profile: profile, invoice_number: TaxInvoice.number_for(LegalConfig.invoice_prefix, financial_year, sequence),
        financial_year:, sequence_number: sequence, document_type: tax.document_type, issued_at:, provider_payment_id: payment_id,
        provider_invoice_id: payment["invoice_id"].presence, currency: "INR", seller: seller.deep_stringify_keys, buyer: buyer.deep_stringify_keys,
        line_items: [line.deep_stringify_keys], sac_code: seller[:sacCode].presence, place_of_supply_code: place_of_supply.presence,
        taxable_paise: tax.taxable_paise, cgst_paise: tax.cgst_paise, sgst_paise: tax.sgst_paise, igst_paise: tax.igst_paise, total_paise: tax.total_paise)
    end
    Notifier.invoice_issued(invoice)
    invoice
  end
  private_class_method :issue!
end
