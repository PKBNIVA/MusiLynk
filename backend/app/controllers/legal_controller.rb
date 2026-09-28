# Public, read-only compliance/policy data for the Terms and Privacy pages, so those pages read
# from the same config the server enforces (config/bookings.yml, config/legal.yml) and never
# drift from it. See LegalPage.tsx.
class LegalController < ApplicationController
  def policy
    render json: {
      legal: LegalConfig.public_json,
      booking: { feeEnabled: BookingFeePolicy.enabled?, plainEnglish: BookingFeePolicy.plain_english, policyVersion: BookingFeePolicy.policy_version }
    }
  end
end
