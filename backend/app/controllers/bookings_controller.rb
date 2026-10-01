class BookingsController < ApplicationController
  PAYMENTS_LIMIT = 100
  before_action -> { authenticate!("jobseeker", "employer") }

  def index
    scope = BookingRequest.joins(:act).includes(:requester, act: :owner, booking_quotes: [], booking_payments: [])
      .where("booking_requests.requester_id = ? OR acts.owner_id = ?", current_user.id, current_user.id).order(updated_at: :desc).limit(200)
    render json: { bookings: scope.map { booking_json(_1) } }
  end

  # The hirer's plan capacity for booking enquiries, read by the enquiry form so the limit is known
  # before the first field is filled (J-25), like jobs/limits is for opportunities.
  def limits
    entitlements = Entitlements.for(current_user)
    render json: {
      activeAllowed: entitlements.limit(:bookings),
      activeUsed: BookingRequest.where(requester: current_user, status: Entitlements::ACTIVE_BOOKING_STATUSES).count,
      plan: entitlements.plan_code,
      planName: entitlements.plan.fetch(:name)
    }
  end

  def create
    scalar_keys = %i[actId musicianId eventType eventName eventDate startTime durationMinutes venueName venueAddress city audienceSize indoorOutdoor budgetMin budgetMax currency requirements]
    return render_error("Booking fields must be plain values.", :bad_request, "INVALID_PARAMETER") if scalar_keys.any? { params[_1].is_a?(Array) || params[_1].is_a?(ActionController::Parameters) }
    # A quote asked of a musician (not an act) goes to the musician's own bookings through their solo act.
    act = if params[:musicianId].present?
      musician = SyntheticQa::Demo.publicly_listed(User.discoverable_talent).find_by(id: params[:musicianId].to_s)
      return render_error("This musician is not available for enquiries.", :not_found) unless musician
      return render_error("You cannot book yourself.", :conflict) if musician.id == current_user.id

      solo_act_for(musician)
    else
      Act.where(status: "active").find_by(id: params[:actId].to_s)
    end
    return render_error("This act is no longer available for booking.", :not_found) unless act
    return render_error("You cannot book your own act.", :conflict) if act.owner_id == current_user.id
    event_date = parse_event_date(params[:eventDate])
    date_error = if !event_date then "Choose a valid event date."
    elsif event_date < Date.current then "The event date cannot be in the past."
    end
    booking = nil
    BookingRequest.transaction do
      current_user.lock!
      active = BookingRequest.where(requester: current_user, status: Entitlements::ACTIVE_BOOKING_STATUSES).count
      Entitlements.for(current_user).ensure_capacity!(:bookings, active)
      next if date_error
      booking = BookingRequest.create!(act:, requester: current_user, event_type: params[:eventType], event_name: params[:eventName], event_date:, start_time: params[:startTime], duration_minutes: params[:durationMinutes], venue_name: params[:venueName], venue_address: params[:venueAddress], city: params[:city], audience_size: params[:audienceSize], indoor_outdoor: params[:indoorOutdoor], budget_min: params[:budgetMin], budget_max: params[:budgetMax], currency: params[:currency].presence || "INR", requirements: params[:requirements], production_provided: params[:productionProvided] || [], travel_provided: params[:travelProvided] || false, accommodation_provided: params[:accommodationProvided] || false, status: "requested")
      Notifier.booking_enquiry(booking)
      audit!("booking.create", booking)
    end
    return render_error(date_error, :unprocessable_content) if date_error
    render json: { id: booking.id }, status: :created
  rescue Entitlements::LimitReached => error
    render_error(error.message, :payment_required, Entitlements::ERROR_CODE)
  end

  def quote
    booking = party_booking
    return render_error("Only the act owner can send a quote.", :forbidden) unless booking.act.owner_id == current_user.id
    quote = nil
    booking.with_lock do
      raise BookingRequest::InvalidTransition unless %w[requested viewed negotiating quoted].include?(booking.status)
      # A new quote supersedes the previous open one; only the latest can be accepted and paid.
      booking.booking_quotes.where(status: "sent").update_all(status: "superseded", updated_at: Time.current)
      total = [params[:performanceFee], params[:travelFee], params[:productionFee], params[:otherFee]].map(&:to_i).sum
      breakdown = BookingFeePolicy.fee_breakdown(total)
      quote = booking.booking_quotes.create!(created_by: current_user, performance_fee: params[:performanceFee], travel_fee: params[:travelFee] || 0, production_fee: params[:productionFee] || 0, other_fee: params[:otherFee] || 0, currency: (params[:currency].presence || booking.currency).to_s.strip.upcase, deposit_percent: params[:depositPercent] || 50, valid_until: params[:validUntil], inclusions: params[:inclusions], exclusions: params[:exclusions], cancellation_terms: params[:cancellationTerms], status: "sent",
        fee_amount: breakdown.hirer_fee_amount, gst_amount: breakdown.gst_amount, fee_percent: breakdown.fee_percent, policy_version: breakdown.policy_version)
      booking.update!(status: "quoted")
      Notifier.booking_quote(booking)
    end
    render json: { id: quote.id, total: quote.total }, status: :created
  rescue BookingRequest::InvalidTransition
    render_error("This booking can no longer be quoted.", :conflict)
  end

  CHANGE_MESSAGE_LIMIT = 1_000

  def change_status
    booking = party_booking
    previous_status = booking.status
    note = params[:message].is_a?(String) ? params[:message].strip.presence : nil
    return render_error("Keep your message under #{CHANGE_MESSAGE_LIMIT} characters.", :unprocessable_content, "MESSAGE_TOO_LONG") if note && note.length > CHANGE_MESSAGE_LIMIT
    booking.transition_to!(params[:status].to_s, actor: current_user)
    Notifier.booking_status(booking, actor: current_user)
    # "Ask for changes" can say what to change; the words go to the other side in the pair's thread.
    conversation = post_change_request(booking, note) if note && booking.status == "negotiating"
    refund = maybe_record_refund!(booking, previous_status:, actor: current_user, no_show: params[:noShow])
    render json: { ok: true, status: booking.status, refund: refund && refund_json(refund), conversationId: conversation&.id }
  rescue BookingRequest::InvalidTransition => error
    render_error(error.message, error.http_status)
  end

  def payment_order
    booking = BookingRequest.includes(:booking_quotes).find(params[:id])
    return render_error("Booking not found", :not_found) unless booking.requester_id == current_user.id
    # Fail closed in production without usable keys, and anywhere a key is present but refused for this environment.
    return render_error("Live payments are not configured.", :service_unavailable) if (Rails.env.production? || RazorpayConfig.key_present?) && !RazorpayConfig.usable?
    payment = existing = quote = attempt = nil
    payment_error = nil
    booking.with_lock do
      payment_error = ["Booking must be accepted before payment.", :conflict] unless booking.status == "accepted"
      quote = booking.booking_quotes.where(status: %w[sent accepted]).order(created_at: :desc).first unless payment_error
      payment_error = ["No active quote", :conflict] if !payment_error && !quote
      payment_error = ["This quote has expired.", :conflict] if !payment_error && quote.valid_until.present? && quote.valid_until <= Time.current
      existing = booking.booking_payments.where(kind: "deposit", status: %w[created paid]).order(created_at: :desc).first unless payment_error
      # A Razorpay order that was never issued (crash/ambiguous create) must not block a retry forever.
      existing = nil if existing&.unissued_expired? && existing.expire_unissued!
      unless payment_error || existing
        deposit_amount = (quote.total * quote.deposit_percent / 100.0).round
        breakdown = BookingFeePolicy.fee_breakdown(quote.total)
        # The fee (when enabled) is added on top of the deposit and collected in the same charge;
        # with the fee off (fee_amount/gst_amount both 0) this is exactly deposit_amount, unchanged.
        amount = deposit_amount + breakdown.hirer_fee_amount + breakdown.gst_amount
        payment_error = ["Deposit amount must be greater than zero.", :unprocessable_content] unless amount.positive?
        payment = booking.booking_payments.create!(booking_quote: quote, payer: current_user, kind: "deposit", amount:, currency: quote.currency.to_s.upcase, provider: RazorpayConfig.key_present? ? "razorpay" : "internal", status: "created",
          fee_amount: breakdown.hirer_fee_amount, gst_amount: breakdown.gst_amount, fee_percent: breakdown.fee_percent, policy_version: breakdown.policy_version) unless payment_error
        if payment&.provider == "razorpay"
          attempt = BillingAttempt.create!(user: current_user, operation: "booking_order_create", provider: "razorpay", idempotency_key: billing_idempotency_key("booking_order_create"), state: "pending", resource_type: "BookingPayment", resource_id: payment.id, request_payload: { booking_id: booking.id, amount: payment.amount * 100, currency: payment.currency }, last_attempted_at: Time.current)
        end
      end
    end
    return render_error(*payment_error) if payment_error
    if existing
      return render_error("Deposit is already paid.", :conflict) if existing.status == "paid"
      return render_error("Payment order is being prepared. Retry shortly.", :conflict) if existing.provider == "razorpay" && existing.provider_order_id.blank?
      checkout = existing.provider == "razorpay" ? razorpay_order_checkout(existing.provider_order_id, existing.amount * 100, existing.currency) : { mode: "mock" }
      return render json: { payment: existing, checkout: }
    end
    checkout = if payment.provider == "razorpay"
      order = RazorpayGateway.new.create_order(amount_paise: payment.amount * 100, currency: quote.currency, receipt: payment.provider_receipt, notes: { booking_id: booking.id, payment_id: payment.id, attempt_id: attempt.id })
      attempt.update!(provider_resource_id: order.fetch("id"), response_payload: order)
      BookingPayment.transaction do
        payment.update!(provider_order_id: order.fetch("id"))
        attempt.succeed!(provider_resource_id: order.fetch("id"), response_payload: order)
      end
      razorpay_order_checkout(order.fetch("id"), order.fetch("amount"), order.fetch("currency"))
    else
      { mode: "mock" }
    end
    render json: { payment:, checkout: }
  rescue RazorpayGateway::GatewayError => error
    attempt&.fail_from!(error)
    payment&.update!(status: "failed") unless error.ambiguous?
    render_error(error.ambiguous? ? "Payment provider outcome is pending reconciliation. Do not create another order." : error.message, :bad_gateway)
  rescue ActiveRecord::RecordNotUnique
    render_error("A payment order already exists. Retry shortly.", :conflict)
  end

  def confirm_payment
    payment = BookingPayment.find(params[:id]); return render_error("Payment not found", :not_found) unless payment.payer_id == current_user.id
    return render_error("Payment is already confirmed.", :conflict) if payment.status == "paid" && payment.provider != "razorpay"
    return render_error("Mock payments are disabled in production.", :forbidden) if Rails.env.production? && payment.provider != "razorpay"
    if payment.provider == "razorpay"
      return render_error("Live payments are not configured.", :service_unavailable) unless RazorpayConfig.usable?
      return render_error("Payment order mismatch", :unprocessable_content) unless payment.provider_order_id.present? && ActiveSupport::SecurityUtils.secure_compare(payment.provider_order_id, params[:orderId].to_s)
      expected = OpenSSL::HMAC.hexdigest("SHA256", ENV.fetch("RAZORPAY_KEY_SECRET"), "#{payment.provider_order_id}|#{params[:paymentId]}")
      return render_error("Invalid payment signature", :unprocessable_content) unless ActiveSupport::SecurityUtils.secure_compare(expected, params[:signature].to_s)
      # The signed payment.captured webhook often lands before the checkout handler calls back:
      # the same verified payment is then a success, not a conflict.
      if %w[paid refunded].include?(payment.status)
        return render json: { ok: true, alreadyConfirmed: true } if payment.provider_payment_id.present? && ActiveSupport::SecurityUtils.secure_compare(payment.provider_payment_id, params[:paymentId].to_s)
        return render_error("Payment is already confirmed.", :conflict)
      end
      provider_payment = RazorpayGateway.new.payment(params[:paymentId])
      valid_provider_payment = provider_payment["status"] == "captured" &&
        provider_payment["id"].to_s == params[:paymentId].to_s &&
        provider_payment["order_id"].to_s == payment.provider_order_id &&
        provider_payment["amount"].to_i == payment.amount * 100 &&
        provider_payment["currency"].to_s.upcase == payment.currency
      return render_error("Payment has not been captured for the expected amount.", :unprocessable_content) unless valid_provider_payment

      # Same ledger transition as the signed capture webhook (also recovers a capture after a reported decline).
      result = payment.apply_capture!(entity: provider_payment, event_at: Time.current, event_id: "checkout:#{params[:paymentId]}")
      InvoiceGenerator.for(payment) if %i[applied applied_after_failure].include?(result)
      return render json: { ok: true } if %i[applied applied_after_failure].include?(result)
      return render_error("Payment is already confirmed.", :conflict) if result == :already_paid
      return render_error("A deposit has already been paid for this booking. Contact support about the duplicate payment.", :conflict) if result == :duplicate_capture

      return render_error("This payment can no longer be confirmed.", :conflict)
    end
    payment.with_lock do
      return render_error("Payment is already confirmed.", :conflict) if payment.status == "paid"
      return render_error("This payment can no longer be confirmed.", :conflict) unless payment.status == "created"
      payment.update!(status: "paid", provider_payment_id: params[:paymentId])
    end
    InvoiceGenerator.for(payment)
    render json: { ok: true }
  rescue RazorpayGateway::GatewayError => error
    render_error(error.message, :bad_gateway)
  end

  def payments
    booking = BookingRequest.includes(:act).find(params[:id]); return render_error("Booking not found", :not_found) unless [booking.requester_id, booking.act.owner_id].include?(current_user.id)
    payments = booking.booking_payments.includes(:invoice).order(created_at: :desc).limit(PAYMENTS_LIMIT)
    render json: { payments: payments.map { _1.attributes.merge(invoiceId: _1.invoice&.id) } }
  end

  private

  # The musician's own act for enquiries addressed to them rather than to a lineup. Created on the
  # first enquiry, never listed publicly (inactive), and reused for every later one.
  def solo_act_for(musician)
    musician.owned_acts.find_by(act_type: "solo", status: "inactive") || begin
      profile = musician.profile
      act = musician.owned_acts.create!(name: musician.name, act_type: "solo", currency: "INR", fee_basis: "event", status: "inactive",
        tagline: "Direct enquiries", city: profile&.location, genres: Array(profile&.genres), lineup_size: 1)
      act.act_members.create!(display_name: musician.name, role_name: "Leader", is_leader: true, member_status: "confirmed", user: musician)
      act
    end
  end

  # Puts the change request into the conversation between the two parties (opened if need be).
  def post_change_request(booking, note)
    owner = booking.act.owner
    requester = booking.requester
    return nil if UserBlock.between?(owner, requester) || !owner.active? || !requester.active?

    conversation = Conversation.open_between!(candidate: owner, employer: requester)
    sender = current_user
    message = conversation.messages.new(sender:, body: "Changes requested for #{booking.event_name.presence || booking.act.name}: #{note}".first(MessagesController::MAX_LENGTH))
    message.flag_scam_signals
    message.save!
    Notifier.new_message(message)
    conversation
  end

  def razorpay_order_checkout(order_id, amount_paise, currency)
    { mode: "razorpay", keyId: RazorpayConfig.key_id, amount: amount_paise, currency:, orderId: order_id }.merge(RazorpayConfig.simulator? ? { simulator: true } : {})
  end

  def billing_idempotency_key(operation)
    supplied = request.headers["Idempotency-Key"].to_s.strip
    token = supplied.present? ? supplied.first(180) : SecureRandom.uuid
    "#{current_user.id}:#{operation}:#{token}"
  end

  # Bookings are visible only to their two parties; everyone else gets a 404.
  def party_booking
    BookingRequest.joins(:act).includes(:act).where("booking_requests.requester_id = :id OR acts.owner_id = :id", id: current_user.id).find(params[:id])
  end

  def parse_event_date(value)
    Date.iso8601(value.to_s.first(10))
  rescue ArgumentError, TypeError
    nil
  end
  def allowed_transitions(booking)
    table = booking.act.owner_id == current_user.id ? BookingRequest::OWNER_TRANSITIONS : BookingRequest::REQUESTER_TRANSITIONS
    table.fetch(booking.status, [])
  end

  # Records the intended refund for a cancellation or no-show, per BookingFeePolicy's rules.
  # Never moves money itself (see RefundRecord); only ever runs for a booking that was "accepted"
  # and just became "cancelled" (the requester's normal cancellation path) or "disputed" with an
  # explicit `noShow` party named by whichever side is reporting it.
  def maybe_record_refund!(booking, previous_status:, actor:, no_show:)
    return nil unless previous_status == "accepted" && %w[cancelled disputed].include?(booking.status)
    reason = no_show_reason(no_show) || (booking.status == "cancelled" ? "hirer_cancel" : nil)
    return nil unless reason
    deposit = booking.booking_payments.where(kind: "deposit", status: "paid").order(created_at: :desc).first
    return nil unless deposit

    outcome = BookingFeePolicy.cancellation_outcome(event_date: booking.event_date, reason:)
    amount = outcome.refund_amount_for(deposit.amount)
    RefundRecord.create!(booking_request: booking, booking_payment: deposit, requested_by: actor, amount:,
      currency: deposit.currency, refund_percent: outcome.refund_percent, reason: outcome.reason,
      policy_version: BookingFeePolicy.policy_version, status: amount.positive? ? "pending_manual" : "not_applicable",
      note: outcome.note)
  end

  def no_show_reason(value)
    case value.to_s
    when "musician" then "musician_no_show"
    when "hirer" then "hirer_no_show"
    end
  end

  def refund_json(refund)
    { id: refund.id, amount: refund.amount, currency: refund.currency, refundPercent: refund.refund_percent,
      reason: refund.reason, status: refund.status, note: refund.note }
  end

  def booking_json(b)
    quote = b.booking_quotes.max_by(&:created_at)
    deposit_payment = b.booking_payments.select { _1.kind == "deposit" }.max_by(&:created_at)
    quote_json = quote && {
      id: quote.id, performanceFee: quote.performance_fee, travelFee: quote.travel_fee,
      productionFee: quote.production_fee, otherFee: quote.other_fee, total: quote.total,
      currency: quote.currency, depositPercent: quote.deposit_percent, validUntil: quote.valid_until,
      inclusions: quote.inclusions, exclusions: quote.exclusions,
      cancellationTerms: quote.cancellation_terms, status: quote.status,
      feeAmount: quote.fee_amount, gstAmount: quote.gst_amount, feePercent: quote.fee_percent, policyVersion: quote.policy_version
    }
    b.attributes.merge(actName: b.act.name, requesterName: b.requester.name, isOwner: b.act.owner_id == current_user.id, isRequester: b.requester_id == current_user.id, latestQuoteTotal: quote&.total, latestQuoteCurrency: quote&.currency, latestDepositPercent: quote&.deposit_percent, latestQuote: quote_json, paidAmount: b.booking_payments.select { _1.status == "paid" }.sum(&:amount), paymentCount: b.booking_payments.size,
      depositPaid: b.booking_payments.any? { _1.kind == "deposit" && _1.status == "paid" }, allowedTransitions: allowed_transitions(b),
      depositBreakdown: deposit_payment && { amount: deposit_payment.amount, feeAmount: deposit_payment.fee_amount, gstAmount: deposit_payment.gst_amount, feePercent: deposit_payment.fee_percent, policyVersion: deposit_payment.policy_version },
      bookingPolicy: { feeEnabled: BookingFeePolicy.enabled?, plainEnglish: BookingFeePolicy.plain_english, policyVersion: BookingFeePolicy.policy_version })
  end
end
