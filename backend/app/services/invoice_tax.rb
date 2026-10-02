# The GST split of one charge, in whole paise, so every figure adds up to the total exactly.
#
#   inclusive: `amount_paise` is what the customer paid, GST included (the default for Verse plan
#              prices). The taxable value is backed out of it and the total stays the amount paid.
#   exclusive: `amount_paise` is the price before GST; the tax is added on top.
#
# Intra-state supply (seller state == place of supply) splits the tax into CGST and SGST halves
# (9% + 9%); inter-state supply is IGST (18%). A seller who is not GST-registered issues a bill of
# supply and charges no GST at all.
module InvoiceTax
  Result = Struct.new(:document_type, :taxable_paise, :cgst_paise, :sgst_paise, :igst_paise, :total_paise, :rate_percent, :intra_state,
    keyword_init: true) do
    def gst_paise = cgst_paise + sgst_paise + igst_paise
    def tax_invoice? = document_type == "tax_invoice"
  end

  GST_RATE_PERCENT = 18

  module_function

  def compute(amount_paise:, gst_registered:, prices_include_gst:, seller_state_code:, place_of_supply_code:, rate_percent: GST_RATE_PERCENT)
    amount = Integer(amount_paise)
    raise ArgumentError, "amount must be positive" unless amount.positive?

    unless gst_registered
      return Result.new(document_type: "bill_of_supply", taxable_paise: amount, cgst_paise: 0, sgst_paise: 0, igst_paise: 0,
        total_paise: amount, rate_percent: 0, intra_state: nil)
    end

    intra = place_of_supply_code.present? && place_of_supply_code.to_s == seller_state_code.to_s
    # A price with GST inside it divides the tax out of amount * (100 + rate) / 100; a price without GST has it added.
    denominator = prices_include_gst ? 100 + rate_percent : 100
    round_div = ->(numerator, divisor) { ((numerator * 2) + divisor).div(divisor * 2) } # round half up
    gst = round_div.call(amount * rate_percent, denominator)

    if intra
      # CGST and SGST are always equal halves; an odd paisa is absorbed in the taxable value so
      # that taxable + CGST + SGST is exactly the total.
      half = round_div.call(amount * rate_percent, denominator * 2)
      total = prices_include_gst ? amount : amount + (2 * half)
      Result.new(document_type: "tax_invoice", taxable_paise: total - (2 * half), cgst_paise: half, sgst_paise: half, igst_paise: 0,
        total_paise: total, rate_percent:, intra_state: true)
    else
      total = prices_include_gst ? amount : amount + gst
      Result.new(document_type: "tax_invoice", taxable_paise: total - gst, cgst_paise: 0, sgst_paise: 0, igst_paise: gst,
        total_paise: total, rate_percent:, intra_state: false)
    end
  end
end
