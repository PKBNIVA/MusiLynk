# Extra records the screens need (portfolio, paid deposit + invoice). Idempotent.
b = User.find_by!(email: "qa+demo-showcase-professional-0001@example.invalid")
d = User.find_by!(email: "qa+demo-showcase-employer-0007@example.invalid")
pf = Portfolio.find_by(owner_type: "user", owner_id: b.id) || Portfolio.create!(owner_type: "user", owner_id: b.id, title: "Wedding and live shows", slug: "ux-sweep-#{b.id.last(6)}", visibility: "public", status: "active", headline: "Live sets for sangeets", bio: "Ten years of live shows.", is_default: true, city: "Mumbai", genres: %w[Bollywood Sufi])
br = BookingRequest.find_by!(requester_id: d.id, event_name: "UX sweep accepted") rescue BookingRequest.where(requester_id: d.id).first
q = br.booking_quotes.first rescue BookingQuote.where(booking_request_id: br.id).first
pay = BookingPayment.find_by(booking_request_id: br.id, kind: "deposit") || BookingPayment.create!(booking_request: br, booking_quote: q, payer: d, kind: "deposit", currency: "INR", provider: BookingPayment::PROVIDERS.first, status: "paid", amount: 35_400, fee_amount: 3_000, gst_amount: 540, fee_percent: 5, policy_version: 1, provider_state_at: Time.current)
inv = Invoice.find_by(booking_payment_id: pay.id) || InvoiceGenerator.for(pay)
puts({ portfolio: pf.id, slug: pf.slug, invoice: inv&.id, booking: br.id }.to_json)
