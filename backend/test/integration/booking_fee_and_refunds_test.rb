require "test_helper"

# Covers the booking fee/GST breakdown, its byte-identical-when-off guarantee, the cancellation
# and no-show refund rules (always recorded as pending_manual, never an outbound refund call),
# invoice generation and numbering, and the admin "Refunds to review" endpoints.
class BookingFeeAndRefundsTest < ActionDispatch::IntegrationTest
  setup do
    @artist = create_user("Fee Artist", "jobseeker")
    @buyer = create_user("Fee Buyer", "employer")
    @act = @artist.owned_acts.create!(name: "Fee Band", act_type: "band", currency: "INR", fee_basis: "event", status: "active")
    @admin = User.create!(name: "Fee Admin", email: "fee-admin-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "admin", status: "active")
  end

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

  def create_booking(event_date: 1.month.from_now.to_date)
    BookingRequest.create!(act: @act, requester: @buyer, event_type: "concert", city: "Mumbai", currency: "INR", status: "requested", event_date:)
  end

  def accept_with_quote(booking, performance_fee: 10_000)
    post "/api/bookings/#{booking.id}/quote", params: { performanceFee: performance_fee }, headers: auth(@artist), as: :json
    assert_response :created
    post "/api/bookings/#{booking.id}/status", params: { status: "accepted" }, headers: auth(@buyer), as: :json
    assert_response :success
    booking.reload
  end

  def pay_deposit(booking)
    post "/api/bookings/#{booking.id}/payment-order", headers: auth(@buyer), as: :json
    assert_response :success
    payment = response.parsed_body.fetch("payment")
    post "/api/booking-payments/#{payment.fetch("id")}/confirm", params: { paymentId: "mock_#{SecureRandom.hex(4)}" }, headers: auth(@buyer), as: :json
    assert_response :success
    BookingPayment.find(payment.fetch("id"))
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end

  def create_user(name, role)
    User.create!(name:, email: "#{name.parameterize}-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role:, status: "active").tap(&:create_profile!)
  end

  # --- Byte-identical when the fee is off -----------------------------------------------------

  test "with the platform fee off, the deposit amount and fee breakdown are unchanged" do
    with_fee_config(percent: 0) do
      booking = create_booking
      booking = accept_with_quote(booking)
      quote = booking.booking_quotes.order(:created_at).last
      assert_equal 0, quote.fee_amount
      assert_equal 0, quote.gst_amount

      post "/api/bookings/#{booking.id}/payment-order", headers: auth(@buyer), as: :json
      payment = response.parsed_body.fetch("payment")
      expected_deposit = (quote.total * quote.deposit_percent / 100.0).round
      assert_equal expected_deposit, payment.fetch("amount")
      assert_equal 0, BookingPayment.find(payment.fetch("id")).fee_amount
    end
  end

  # --- Fee enabled -----------------------------------------------------------------------------

  test "with the platform fee on, the quote and deposit include the fee and GST, and an invoice is generated" do
    with_fee_config(percent: 10, gst: 18, paid_by: "hirer") do
      booking = create_booking
      booking = accept_with_quote(booking, performance_fee: 10_000)
      quote = booking.booking_quotes.order(:created_at).last
      assert_equal 1_000, quote.fee_amount
      assert_equal 180, quote.gst_amount

      base_deposit = (quote.total * quote.deposit_percent / 100.0).round
      payment = pay_deposit(booking)
      assert_equal base_deposit + 1_000 + 180, payment.amount
      assert_equal 1_000, payment.fee_amount
      assert_equal 180, payment.gst_amount

      invoice = Invoice.find_by(booking_payment_id: payment.id)
      assert invoice, "expected an invoice to be generated for a fee-bearing payment"
      assert_match(%r{\AV/\d{4}-\d{2}/\d{6}\z}, invoice.invoice_number)
      assert_equal payment.amount, invoice.total_amount

      get "/api/invoices/#{invoice.id}", headers: auth(@buyer), as: :json
      assert_response :success
      assert_equal invoice.invoice_number, response.parsed_body.fetch("invoiceNumber")
      get "/api/invoices/#{invoice.id}", headers: auth(@artist), as: :json
      assert_response :success # the act owner can see it too
    end
  end

  test "no invoice is generated when the fee is off" do
    with_fee_config(percent: 0) do
      booking = accept_with_quote(create_booking)
      payment = pay_deposit(booking)
      assert_nil Invoice.find_by(booking_payment_id: payment.id)
    end
  end

  # --- Cancellation & no-show refunds -----------------------------------------------------------

  test "cancelling well before the event records a full pending_manual refund" do
    booking = accept_with_quote(create_booking(event_date: 30.days.from_now.to_date))
    pay_deposit(booking)

    post "/api/bookings/#{booking.id}/status", params: { status: "cancelled" }, headers: auth(@buyer), as: :json
    assert_response :success
    refund = response.parsed_body.fetch("refund")
    assert_equal 100, refund.fetch("refundPercent")
    assert_equal "pending_manual", refund.fetch("status")

    record = RefundRecord.last
    assert_equal "hirer_cancel", record.reason
    assert_equal booking.booking_payments.where(kind: "deposit").first.amount, record.amount
  end

  test "cancelling just before the event records no refund (not_applicable)" do
    booking = accept_with_quote(create_booking(event_date: 1.day.from_now.to_date))
    pay_deposit(booking)

    post "/api/bookings/#{booking.id}/status", params: { status: "cancelled" }, headers: auth(@buyer), as: :json
    assert_response :success
    refund = response.parsed_body.fetch("refund")
    assert_equal 0, refund.fetch("refundPercent")
    assert_equal "not_applicable", refund.fetch("status")
  end

  test "a musician no-show is a full refund with the fee waived, recorded pending_manual" do
    booking = accept_with_quote(create_booking(event_date: 1.day.from_now.to_date))
    pay_deposit(booking)

    post "/api/bookings/#{booking.id}/status", params: { status: "disputed", noShow: "musician" }, headers: auth(@buyer), as: :json
    assert_response :success
    refund = response.parsed_body.fetch("refund")
    assert_equal 100, refund.fetch("refundPercent")
    assert_equal "musician_no_show", refund.fetch("reason")
    assert_equal "pending_manual", refund.fetch("status")
  end

  test "a hirer no-show keeps the deposit" do
    booking = accept_with_quote(create_booking(event_date: 1.day.from_now.to_date))
    pay_deposit(booking)

    post "/api/bookings/#{booking.id}/status", params: { status: "disputed", noShow: "hirer" }, headers: auth(@artist), as: :json
    assert_response :success
    refund = response.parsed_body.fetch("refund")
    assert_equal 0, refund.fetch("refundPercent")
    assert_equal "hirer_no_show", refund.fetch("reason")
  end

  test "no refund record when there is no paid deposit to refund" do
    booking = accept_with_quote(create_booking)
    post "/api/bookings/#{booking.id}/status", params: { status: "cancelled" }, headers: auth(@buyer), as: :json
    assert_response :success
    assert_nil response.parsed_body["refund"]
    assert_equal 0, RefundRecord.count
  end

  # --- Admin "Refunds to review" ------------------------------------------------------------------

  test "admin can list and mark a pending_manual refund done, and a non-admin cannot" do
    booking = accept_with_quote(create_booking(event_date: 30.days.from_now.to_date))
    pay_deposit(booking)
    post "/api/bookings/#{booking.id}/status", params: { status: "cancelled" }, headers: auth(@buyer), as: :json
    refund_id = response.parsed_body.fetch("refund").fetch("id")

    get "/api/admin/refunds", params: { status: "pending_manual" }, headers: auth(@buyer)
    assert_response :forbidden

    get "/api/admin/refunds", params: { status: "pending_manual" }, headers: auth(@admin)
    assert_response :success
    assert(response.parsed_body.fetch("refunds").any? { _1.fetch("id") == refund_id })

    patch "/api/admin/refunds/#{refund_id}", params: { note: "Refunded manually in Razorpay dashboard" }, headers: auth(@admin), as: :json
    assert_response :success
    assert_equal "done", response.parsed_body.fetch("status")
    assert_equal "done", RefundRecord.find(refund_id).status

    patch "/api/admin/refunds/#{refund_id}", headers: auth(@admin), as: :json
    assert_response :conflict
  end
end
