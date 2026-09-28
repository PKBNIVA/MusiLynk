module Admin
  class OperationsController < BaseController
    include AdminPagination

    # Traffic, background jobs, payments and email health for the last hour and day.
    def show = render(json: OperationsSnapshot.new.call)

    def audit
      rows, meta = admin_paginate(AuditLog.includes(:actor).order(created_at: :desc), default_per: 100)
      render json: { logs: rows.map { _1.attributes.merge(actorName: _1.actor&.name) } }.merge(meta)
    end

    def subscriptions
      rows, meta = admin_paginate(Subscription.includes(:user).order(created_at: :desc), default_per: 100)
      render json: { subscriptions: rows.map { _1.attributes.merge(name: _1.user.name, email: _1.user.email) } }.merge(meta)
    end

    def billing_attempts
      rows, meta = admin_paginate(BillingAttempt.includes(:user).order(created_at: :desc), default_per: 100)
      render json: { attempts: rows.map { _1.attributes.merge(email: _1.user.email) } }.merge(meta)
    end

    def reconcile_billing_attempt
      attempt = BillingAttempt.find(params[:id])
      return render_error("Razorpay is not configured for this environment.", :service_unavailable, "PAYMENTS_NOT_CONFIGURED") unless RazorpayConfig.usable?

      BillingAttemptReconciler.new.call(attempt)
      audit!("admin.billing_attempt.reconcile", attempt)
      render json: { attempt: }
    rescue BillingAttemptReconciler::ProviderResourceMissing => error
      render_error(error.message, :not_found, "PROVIDER_RESOURCE_MISSING")
    rescue ArgumentError => error
      render_error(error.message, :conflict)
    rescue RazorpayGateway::GatewayError => error
      render_error(error.message, :bad_gateway)
    end
    def bookings
      page_rows, meta = admin_paginate(BookingRequest.includes(:requester, act: :owner, booking_payments: []).order(created_at: :desc), default_per: 100)
      rows = page_rows.map do |booking|
        booking.attributes.merge(actName: booking.act.name, actOwner: booking.act.owner.name, requesterName: booking.requester.name, paidAmount: booking.booking_payments.select { _1.status == "paid" }.sum(&:amount))
      end
      render json: { bookings: rows }.merge(meta)
    end
  end
end
