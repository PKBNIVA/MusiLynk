module Admin
  # Read-only list of subscription invoices and the accountant's CSV export for a date range.
  class InvoicesController < BaseController
    include AdminPagination

    CSV_LIMIT = 20_000
    MAX_RANGE_DAYS = 400
    CSV_HEADERS = %w[invoice_number date buyer_name buyer_type gstin state taxable cgst sgst igst total document_type refund_status payment_reference].freeze

    def index
      scope = TaxInvoice.includes(:user).newest_first
      scope = scope.where(user_id: params[:userId]) if params[:userId].present?
      rows, meta = admin_paginate(scope, default_per: 50)
      render json: { invoices: rows.map { _1.list_json.merge(email: _1.user.email, userId: _1.user_id) },
                     sellerPending: LegalConfig.invoice_pending_fields }.merge(meta)
    end

    # GET /api/admin/invoices/export.csv?from=2026-04-01&to=2026-06-30 (inclusive, IST dates).
    def export
      from = parse_date(params[:from])
      to = parse_date(params[:to])
      return render_error("Choose a from and a to date, like 2026-04-01.", :bad_request, "DATE_RANGE_REQUIRED") unless from && to
      return render_error("The to date is before the from date.", :bad_request, "DATE_RANGE_INVALID") if to < from
      return render_error("Choose a range of #{MAX_RANGE_DAYS} days or less.", :bad_request, "DATE_RANGE_TOO_LONG") if (to - from).to_i > MAX_RANGE_DAYS

      zone = ActiveSupport::TimeZone["Asia/Kolkata"]
      scope = TaxInvoice.where(issued_at: zone.local(from.year, from.month, from.day).beginning_of_day..zone.local(to.year, to.month, to.day).end_of_day).order(:issued_at, :id)
      audit!("admin.invoices.export", nil, from: from.iso8601, to: to.iso8601, count: scope.count)
      lines = [CSV_HEADERS] + scope.limit(CSV_LIMIT).map { row(_1, zone) }
      send_data lines.map { |values| values.map { csv_cell(_1) }.join(",") }.join("\n") << "\n",
        type: "text/csv; charset=utf-8", disposition: "attachment", filename: "invoices-#{from.iso8601}-to-#{to.iso8601}.csv"
    end

    private

    def parse_date(value)
      Date.iso8601(value.to_s)
    rescue ArgumentError, TypeError
      nil
    end

    def rupees(paise) = format("%.2f", paise / 100.0)

    def row(invoice, zone)
      buyer = invoice.buyer
      [invoice.invoice_number, invoice.issued_at.in_time_zone(zone).to_date.iso8601, buyer["name"], buyer["type"], buyer["gstin"], buyer["state"],
       rupees(invoice.taxable_paise), rupees(invoice.cgst_paise), rupees(invoice.sgst_paise), rupees(invoice.igst_paise), rupees(invoice.total_paise),
       invoice.document_type, invoice.refund_status, invoice.provider_payment_id]
    end

    # A spreadsheet would run a cell that starts with = + - or @ as a formula.
    def csv_cell(value)
      text = value.to_s
      text = "'#{text}" if text.match?(/\A[=+\-@\t\r]/)
      "\"#{text.gsub('"', '""')}\""
    end
  end
end
