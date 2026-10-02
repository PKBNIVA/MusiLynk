module Billing
  # The signed-in account's own subscription invoices. Another account's invoice id answers 404,
  # the same as one that does not exist.
  class InvoicesController < ApplicationController
    before_action -> { authenticate!("jobseeker", "employer") }

    def index
      invoices = TaxInvoice.where(user_id: current_user.id).newest_first.limit(100)
      render json: { invoices: invoices.map(&:list_json) }
    end

    def show
      invoice = TaxInvoice.find_by(id: params[:id], user_id: current_user.id)
      return render_error("Invoice not found", :not_found) unless invoice

      render json: { invoice: invoice.document_json.merge(sellerPendingBanner: !Rails.env.production? && invoice.seller_pending?) }
    end
  end
end
