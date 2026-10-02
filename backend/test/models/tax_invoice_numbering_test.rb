require "test_helper"
require_relative "../support/seller_config"

class TaxInvoiceNumberingTest < ActiveSupport::TestCase
  test "numbers are formatted per series and financial year" do
    assert_equal "MLK/2026-27/000123", TaxInvoice.number_for("MLK", "2026-27", 123)
  end

  test "financial year follows IST, not UTC" do
    assert_equal "2025-26", TaxInvoice.financial_year_at(Time.utc(2026, 3, 31, 18, 29)) # 23:59 IST on 31 March
    assert_equal "2026-27", TaxInvoice.financial_year_at(Time.utc(2026, 3, 31, 18, 30)) # 00:00 IST on 1 April
  end

  test "sequence starts at 1 per financial year and counts up without gaps" do
    assert_equal [1, 2, 3], Array.new(3) { TaxInvoice.transaction { TaxInvoice.next_sequence!("MLK", "2026-27") } }
    assert_equal 1, TaxInvoice.transaction { TaxInvoice.next_sequence!("MLK", "2027-28") }
    assert_equal 1, TaxInvoice.transaction { TaxInvoice.next_sequence!("OTHER", "2026-27") }
    assert_equal 4, TaxInvoice.transaction { TaxInvoice.next_sequence!("MLK", "2026-27") }
  end

  test "a rolled back issue does not use up a number" do
    assert_equal 1, TaxInvoice.transaction { TaxInvoice.next_sequence!("MLK", "2026-27") }
    assert_raises(RuntimeError) do
      TaxInvoice.transaction(requires_new: true) do
        TaxInvoice.next_sequence!("MLK", "2026-27")
        raise "payment failed after numbering"
      end
    end
    assert_equal 2, TaxInvoice.transaction { TaxInvoice.next_sequence!("MLK", "2026-27") }
  end

end

# Real concurrent writers need real commits, so this class turns transactional tests off and cleans up itself.
class TaxInvoiceConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include SellerConfig

  setup do
    @ids = []
    use_seller
  end

  teardown do
    LegalConfig.reload!
    TaxInvoice.where(user_id: @ids).delete_all
    Subscription.where(user_id: @ids).delete_all
    BillingProfile.where(user_id: @ids).delete_all
    InvoiceCounterCleaner.run
    User.where(id: @ids).delete_all
  end

  module InvoiceCounterCleaner
    def self.run = ActiveRecord::Base.lease_connection.execute("DELETE FROM invoice_counters WHERE series = 'MLK'")
  end

  test "parallel charges get distinct, gap-free numbers" do
    InvoiceCounterCleaner.run
    users = Array.new(8) { |i| User.create!(name: "Concurrent #{i}", email: "conc-#{i}-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "employer", status: "active") }
    @ids = users.map(&:id)
    subs = users.map { Subscription.create!(user: _1, plan_code: "pro", provider: "razorpay", status: "active", provider_subscription_id: "sub_#{SecureRandom.hex(5)}") }
    charged_at = Time.utc(2026, 10, 2, 6).to_i

    threads = subs.each_with_index.map do |sub, i|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          TaxInvoiceGenerator.for_charge(subscription: sub, payment: { "id" => "pay_conc_#{i}_#{SecureRandom.hex(3)}", "amount" => 249_900, "currency" => "INR", "status" => "captured", "created_at" => charged_at })
        end
      end
    end
    threads.each(&:join)

    numbers = TaxInvoice.where(user_id: @ids).order(:sequence_number).pluck(:invoice_number)
    assert_equal 8, numbers.size
    assert_equal (1..8).map { TaxInvoice.number_for("MLK", "2026-27", _1) }, numbers
  end

  test "the same payment racing in twice is invoiced once" do
    InvoiceCounterCleaner.run
    user = User.create!(name: "Race Buyer", email: "race-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "employer", status: "active")
    @ids = [user.id]
    sub = Subscription.create!(user:, plan_code: "pro", provider: "razorpay", status: "active", provider_subscription_id: "sub_#{SecureRandom.hex(5)}")
    payment = { "id" => "pay_race_#{SecureRandom.hex(3)}", "amount" => 249_900, "currency" => "INR", "status" => "captured", "created_at" => Time.utc(2026, 10, 2, 6).to_i }

    Array.new(4) { Thread.new { ActiveRecord::Base.connection_pool.with_connection { TaxInvoiceGenerator.for_charge(subscription: sub, payment:) } } }.each(&:join)

    assert_equal 1, TaxInvoice.where(user_id: user.id).count
    assert_equal 1, TaxInvoice.find_by(user_id: user.id).sequence_number
  end
end
