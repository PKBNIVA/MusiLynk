module Admin
  # "Email members waiting for payments": GET shows who is waiting, POST queues the emails.
  class PaymentsOpenEmailsController < BaseController
    def show = render(json: summary)

    def create
      return render_error("Payments are not open yet. Add working Razorpay keys first.", :service_unavailable, "PAYMENTS_NOT_CONFIGURED") unless RazorpayConfig.usable?

      current = summary
      PaymentsOpenEmailsJob.perform_later
      audit!("admin.payments_open_emails.queue", nil, { waiting: current[:waiting], sendable: current[:sendable] })
      render json: current, status: :accepted
    end

    private

    def summary = { usable: RazorpayConfig.usable?, waiting: PaymentsOpenEmails.waiting, sendable: PaymentsOpenEmails.sendable }
  end
end
