module Billing
  # GET/PUT /api/billing/profile: the signed-in account's own billing details (individual or
  # business, GSTIN, address) used on every invoice issued from now on. A change adds a new version;
  # invoices already issued keep the details they were issued with.
  class ProfilesController < ApplicationController
    include UserRateLimit

    before_action -> { authenticate!("jobseeker", "employer") }

    def show
      render json: payload(BillingProfile.current_for(current_user))
    end

    def update
      return unless within_user_rate_limit?("billing-profile")

      profile = BillingProfile.save_for(current_user, permitted)
      return render_error("Check the highlighted billing details.", :unprocessable_content, "VALIDATION_FAILED", fields: profile.errors.to_hash) if profile.errors.any?

      audit!("billing.profile.save", profile, { version: profile.version, buyerType: profile.buyer_type, gstin: profile.gstin.present? })
      render json: payload(profile)
    end

    private

    def permitted
      raw = params.permit(:buyerType, :legalName, :gstin, :pan, :addressLine1, :addressLine2, :city, :stateCode, :postalCode, :billingEmail, :poReference)
      { buyer_type: raw[:buyerType].presence || "individual", legal_name: raw[:legalName], gstin: raw[:gstin], pan: raw[:pan], address_line1: raw[:addressLine1],
        address_line2: raw[:addressLine2], city: raw[:city], state_code: raw[:stateCode], postal_code: raw[:postalCode], billing_email: raw[:billingEmail],
        po_reference: raw[:poReference] }.transform_values { _1.is_a?(String) ? _1 : (_1.nil? ? nil : _1.to_s) }
    end

    def payload(profile)
      { profile: profile&.as_json_for_owner, states: IndianStates.all, defaults: { legalName: current_user.name, billingEmail: current_user.email } }
    end
  end
end
