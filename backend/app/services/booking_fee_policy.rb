# Loads config/bookings.yml once per process (same pattern as AiPricing) and computes the fee
# breakdown and cancellation/no-show refund outcome from it.
#
# SAFETY: with platform_fee_percent == 0 (the shipped default), #fee_breakdown always returns
# zero fee/GST amounts, so nothing downstream that adds fee_amount + gst_amount to an existing
# amount changes behaviour. Never call the Razorpay API from here — this class only computes
# numbers and never moves money.
class BookingFeePolicy
  CONFIG_PATH = Rails.root.join("config/bookings.yml")
  FEE_PAID_BY = %w[hirer split].freeze

  Breakdown = Struct.new(:fee_percent, :fee_amount, :hirer_fee_amount, :musician_fee_amount, :gst_amount, :gst_percent, :policy_version, :fee_paid_by, keyword_init: true) do
    def hirer_total = hirer_fee_amount + gst_amount
    def enabled? = fee_amount.positive?
  end

  RefundOutcome = Struct.new(:refund_percent, :fee_waived, :reason, :note, keyword_init: true) do
    def refund_amount_for(deposit_amount) = (deposit_amount * refund_percent / 100.0).round
  end

  def self.config
    @config ||= YAML.safe_load(File.read(CONFIG_PATH), aliases: true).fetch(Rails.env, {}).deep_symbolize_keys
  end

  def self.reload! = @config = nil

  def self.policy_version = config.fetch(:policy_version, 1)
  def self.platform_fee_percent = config.fetch(:platform_fee_percent, 0).to_f
  def self.fee_paid_by = FEE_PAID_BY.include?(config[:fee_paid_by].to_s) ? config[:fee_paid_by].to_s : "hirer"
  def self.min_fee_inr = config.fetch(:min_fee_inr, 0).to_i
  def self.gst_percent = config.fetch(:gst_percent, 18).to_f
  def self.cancellation = config.fetch(:cancellation, {})
  def self.full_refund_days = cancellation.fetch(:full_refund_days, 7).to_i
  def self.partial_refund_days = cancellation.fetch(:partial_refund_days, 2).to_i
  def self.partial_refund_percent = cancellation.fetch(:partial_refund_percent, 50).to_i
  def self.enabled? = platform_fee_percent.positive?

  # The fee/GST breakdown for a booking whose quote totals `total` (whole INR, matching
  # BookingQuote#total). Only the hirer's share is ever added to an amount actually charged
  # (Razorpay order / deposit); the musician's share (under "split") is informational only.
  def self.fee_breakdown(total)
    pct = platform_fee_percent
    fee_amount = pct.positive? ? [(total * pct / 100.0).round, min_fee_inr].max : 0
    paid_by = fee_paid_by
    hirer_share = paid_by == "split" ? (fee_amount / 2.0).round : fee_amount
    musician_share = fee_amount - hirer_share
    gst_amount = hirer_share.positive? ? (hirer_share * gst_percent / 100.0).round : 0
    Breakdown.new(fee_percent: pct, fee_amount:, hirer_fee_amount: hirer_share, musician_fee_amount: musician_share,
      gst_amount:, gst_percent:, policy_version:, fee_paid_by: paid_by)
  end

  # `reason`: "hirer_cancel" (default, day-window rules), "musician_no_show" (full refund, fee
  # waived) or "hirer_no_show" (deposit kept, nothing to refund).
  def self.cancellation_outcome(event_date:, reason: "hirer_cancel", cancelled_at: Time.current)
    case reason.to_s
    when "musician_no_show"
      return RefundOutcome.new(refund_percent: 100, fee_waived: true, reason: "musician_no_show",
        note: "The musician did not show. Full deposit refund and the platform fee is waived.")
    when "hirer_no_show"
      return RefundOutcome.new(refund_percent: 0, fee_waived: false, reason: "hirer_no_show",
        note: "The hirer did not show. The deposit is kept.")
    end

    days_until_event = event_date ? ((event_date.to_date - cancelled_at.to_date).to_i) : 0
    if days_until_event > full_refund_days
      RefundOutcome.new(refund_percent: 100, fee_waived: false, reason: "hirer_cancel",
        note: "Cancelled more than #{full_refund_days} days before the event: full refund of the deposit.")
    elsif days_until_event > partial_refund_days
      RefundOutcome.new(refund_percent: partial_refund_percent, fee_waived: false, reason: "hirer_cancel",
        note: "Cancelled #{partial_refund_days}-#{full_refund_days} days before the event: #{partial_refund_percent}% of the deposit is refunded.")
    else
      RefundOutcome.new(refund_percent: 0, fee_waived: false, reason: "hirer_cancel",
        note: "Cancelled within #{partial_refund_days} days of the event: no refund of the deposit.")
    end
  end

  # Plain-language summary of the current policy, for the Terms page and quote/booking UI so both
  # parties see the same rules the server enforces. Never drifts from the code because it reads
  # the same config.
  def self.plain_english
    lines = []
    lines << if enabled?
      "Verse charges a platform fee of #{format_percent(platform_fee_percent)} of the quoted total" \
        "#{min_fee_inr.positive? ? " (minimum ₹#{min_fee_inr})" : ""}, plus #{format_percent(gst_percent)} GST on the fee." \
        " #{fee_paid_by == "split" ? "The fee is split between the hirer and the musician's payout." : "The fee is added to the hirer's deposit."}"
    else
      "Verse does not currently charge a platform fee on bookings."
    end
    lines << "If the hirer cancels more than #{full_refund_days} days before the event, the deposit is fully refunded."
    lines << "If the hirer cancels #{partial_refund_days}-#{full_refund_days} days before the event, #{partial_refund_percent}% of the deposit is refunded."
    lines << "If the hirer cancels within #{partial_refund_days} days of the event, the deposit is not refunded."
    lines << "If the musician does not show up, the deposit is fully refunded and the platform fee is waived."
    lines << "If the hirer does not show up, the deposit is kept."
    lines
  end

  def self.format_percent(value)
    value == value.to_i ? "#{value.to_i}%" : "#{value}%"
  end
end
