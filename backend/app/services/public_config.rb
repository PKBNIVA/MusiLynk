# The body of GET /api/public/config: every business value the frontend needs (fees and
# cancellation rules, plans, limits, catalogue lists, anonymous feature flags), read from the same
# Settings files the server enforces so the client never keeps its own copy. No database access.
module PublicConfig
  module_function

  def payload(now: Time.current)
    {
      fees: fees,
      plans: PlanCatalog.all.values,
      limits: Limits.public_json,
      catalog: Catalog.public_json,
      features: Features.for(nil),
      generatedAt: now.iso8601
    }
  end

  def fees
    { platformFeePercent: BookingFeePolicy.platform_fee_percent, feePaidBy: BookingFeePolicy.fee_paid_by, minFeeInr: BookingFeePolicy.min_fee_inr,
      gstPercent: BookingFeePolicy.gst_percent, policyVersion: BookingFeePolicy.policy_version, enabled: BookingFeePolicy.enabled?,
      cancellation: { fullRefundDays: BookingFeePolicy.full_refund_days, partialRefundDays: BookingFeePolicy.partial_refund_days, partialRefundPercent: BookingFeePolicy.partial_refund_percent },
      plainEnglish: BookingFeePolicy.plain_english }
  end
end
