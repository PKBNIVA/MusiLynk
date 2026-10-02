# Issues invoices for subscription charges that were taken before the seller details in
# config/legal.yml were filled in (see TaxInvoiceGenerator.catch_up!). A no-op once none are missing.
class TaxInvoiceCatchUpJob < ApplicationJob
  queue_as :scheduled

  def perform = TaxInvoiceGenerator.catch_up!
end
