require "test_helper"

class InvoiceTest < ActiveSupport::TestCase
  test "financial_year_for follows the Indian April-March year" do
    assert_equal "2026-27", Invoice.financial_year_for(Date.new(2026, 4, 1))
    assert_equal "2026-27", Invoice.financial_year_for(Date.new(2027, 3, 31))
    assert_equal "2025-26", Invoice.financial_year_for(Date.new(2026, 3, 31))
    assert_equal "2027-28", Invoice.financial_year_for(Date.new(2027, 4, 1))
  end

  test "number_for formats a zero-padded sequence" do
    assert_equal "V/2026-27/000001", Invoice.number_for("2026-27", 1)
    assert_equal "V/2026-27/123456", Invoice.number_for("2026-27", 123_456)
  end

  test "next_sequence_for starts at 1 per financial year and resets across the FY boundary" do
    assert_equal 1, Invoice.next_sequence_for("2025-26")

    artist = User.create!(name: "Invoice Artist", email: "invoice-artist-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    buyer = User.create!(name: "Invoice Buyer", email: "invoice-buyer-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "employer", status: "active")
    act = artist.owned_acts.create!(name: "Invoice Band", act_type: "band", currency: "INR", fee_basis: "event", status: "active")
    payment = ->(fy_marker) do
      booking = BookingRequest.create!(act:, requester: buyer, event_type: "concert", city: "Pune", currency: "INR", status: "accepted", event_date: 1.month.from_now.to_date)
      quote = booking.booking_quotes.create!(created_by: artist, performance_fee: 10_000, deposit_percent: 50, currency: "INR", status: "accepted")
      booking.booking_payments.create!(booking_quote: quote, payer: buyer, kind: "deposit", amount: 5_180, currency: "INR", provider: "internal", status: "paid", fee_amount: 1_000, gst_amount: 180, fee_percent: 10, policy_version: 1, provider_state_at: fy_marker)
    end

    first = InvoiceGenerator.for(payment.call(Date.new(2026, 3, 31))) # FY 2025-26
    second = InvoiceGenerator.for(payment.call(Date.new(2026, 4, 1))) # FY 2026-27: sequence resets

    assert_equal "2025-26", first.financial_year
    assert_equal "2026-27", second.financial_year
    assert_equal 1, second.sequence_number
    assert_not_equal first.invoice_number, second.invoice_number
  end

  test "InvoiceGenerator.for is idempotent and skips a payment with no fee" do
    artist = User.create!(name: "Idem Artist", email: "idem-artist-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active")
    buyer = User.create!(name: "Idem Buyer", email: "idem-buyer-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "employer", status: "active")
    act = artist.owned_acts.create!(name: "Idem Band", act_type: "band", currency: "INR", fee_basis: "event", status: "active")
    booking = BookingRequest.create!(act:, requester: buyer, event_type: "concert", city: "Pune", currency: "INR", status: "accepted", event_date: 1.month.from_now.to_date)
    quote = booking.booking_quotes.create!(created_by: artist, performance_fee: 10_000, deposit_percent: 50, currency: "INR", status: "accepted")
    fee_payment = booking.booking_payments.create!(booking_quote: quote, payer: buyer, kind: "deposit", amount: 6_180, currency: "INR", provider: "internal", status: "paid", fee_amount: 1_000, gst_amount: 180, fee_percent: 10, policy_version: 1)
    no_fee_payment = booking.booking_payments.create!(booking_quote: quote, payer: buyer, kind: "balance", amount: 5_000, currency: "INR", provider: "internal", status: "paid")

    assert_nil InvoiceGenerator.for(no_fee_payment)
    first_call = InvoiceGenerator.for(fee_payment)
    second_call = InvoiceGenerator.for(fee_payment)
    assert_equal first_call.id, second_call.id
    assert_equal 1, Invoice.where(booking_payment_id: fee_payment.id).count
  end
end
