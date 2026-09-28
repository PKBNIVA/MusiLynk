require "test_helper"

class BookingFeePolicyTest < ActiveSupport::TestCase
  def with_fee_config(percent: 0, paid_by: "hirer", min_fee: 0, gst: 18, full_refund_days: 7, partial_refund_days: 2, partial_refund_percent: 50, policy_version: 1)
    original = BookingFeePolicy.config
    BookingFeePolicy.instance_variable_set(:@config, {
      policy_version:, platform_fee_percent: percent, fee_paid_by: paid_by, min_fee_inr: min_fee, gst_percent: gst,
      cancellation: { full_refund_days:, partial_refund_days:, partial_refund_percent: }
    })
    yield
  ensure
    BookingFeePolicy.instance_variable_set(:@config, original)
  end

  test "fee_breakdown is all-zero when the platform fee is off (the shipped default)" do
    with_fee_config(percent: 0) do
      assert_equal false, BookingFeePolicy.enabled?
      breakdown = BookingFeePolicy.fee_breakdown(10_000)
      assert_equal 0, breakdown.fee_amount
      assert_equal 0, breakdown.hirer_fee_amount
      assert_equal 0, breakdown.gst_amount
      refute breakdown.enabled?
    end
  end

  test "fee_breakdown computes fee, floor and GST when enabled and paid by the hirer" do
    with_fee_config(percent: 10, min_fee: 50, gst: 18, paid_by: "hirer") do
      breakdown = BookingFeePolicy.fee_breakdown(10_000)
      assert_equal 1_000, breakdown.fee_amount
      assert_equal 1_000, breakdown.hirer_fee_amount
      assert_equal 0, breakdown.musician_fee_amount
      assert_equal 180, breakdown.gst_amount
      assert_equal 1_180, breakdown.hirer_total
      assert breakdown.enabled?
    end
  end

  test "fee_breakdown applies the minimum fee floor" do
    with_fee_config(percent: 1, min_fee: 500) do
      breakdown = BookingFeePolicy.fee_breakdown(1_000)
      assert_equal 500, breakdown.fee_amount
    end
  end

  test "fee_breakdown splits the fee between hirer and musician when configured" do
    with_fee_config(percent: 10, paid_by: "split") do
      breakdown = BookingFeePolicy.fee_breakdown(10_000)
      assert_equal 1_000, breakdown.fee_amount
      assert_equal 500, breakdown.hirer_fee_amount
      assert_equal 500, breakdown.musician_fee_amount
      assert_equal 90, breakdown.gst_amount # 18% of the hirer's 500 share only
    end
  end

  test "cancellation_outcome gives a full refund well before the event" do
    with_fee_config(full_refund_days: 7, partial_refund_days: 2, partial_refund_percent: 50) do
      outcome = BookingFeePolicy.cancellation_outcome(event_date: 10.days.from_now, cancelled_at: Time.current)
      assert_equal 100, outcome.refund_percent
      refute outcome.fee_waived
    end
  end

  test "cancellation_outcome gives a partial refund in the middle window" do
    with_fee_config(full_refund_days: 7, partial_refund_days: 2, partial_refund_percent: 50) do
      outcome = BookingFeePolicy.cancellation_outcome(event_date: 4.days.from_now, cancelled_at: Time.current)
      assert_equal 50, outcome.refund_percent
    end
  end

  test "cancellation_outcome gives no refund close to the event" do
    with_fee_config(full_refund_days: 7, partial_refund_days: 2) do
      outcome = BookingFeePolicy.cancellation_outcome(event_date: 1.day.from_now, cancelled_at: Time.current)
      assert_equal 0, outcome.refund_percent
    end
  end

  test "cancellation_outcome for a musician no-show is a full refund with the fee waived" do
    outcome = BookingFeePolicy.cancellation_outcome(event_date: 1.day.from_now, reason: "musician_no_show")
    assert_equal 100, outcome.refund_percent
    assert outcome.fee_waived
  end

  test "cancellation_outcome for a hirer no-show keeps the deposit" do
    outcome = BookingFeePolicy.cancellation_outcome(event_date: 1.day.from_now, reason: "hirer_no_show")
    assert_equal 0, outcome.refund_percent
  end

  test "plain_english says there is no fee when disabled" do
    with_fee_config(percent: 0) do
      assert_match(/does not currently charge/, BookingFeePolicy.plain_english.first)
    end
  end
end
