require "test_helper"

class InvoiceTaxTest < ActiveSupport::TestCase
  def compute(amount, include: true, registered: true, seller: "27", place: "27")
    InvoiceTax.compute(amount_paise: amount, gst_registered: registered, prices_include_gst: include, seller_state_code: seller, place_of_supply_code: place)
  end

  def assert_adds_up(result)
    assert_equal result.total_paise, result.taxable_paise + result.cgst_paise + result.sgst_paise + result.igst_paise
  end

  test "intra-state inclusive splits 9% + 9% and the total is the amount charged" do
    r = compute(249_900) # Pro monthly, Rs 2,499
    assert_equal "tax_invoice", r.document_type
    assert r.intra_state
    assert_equal [211_780, 19_060, 19_060, 0, 249_900], [r.taxable_paise, r.cgst_paise, r.sgst_paise, r.igst_paise, r.total_paise]
    assert_adds_up r
  end

  test "inter-state inclusive is IGST 18% and the total is the amount charged" do
    r = compute(249_900, place: "29")
    assert_not r.intra_state
    assert_equal [211_780, 0, 0, 38_120, 249_900], [r.taxable_paise, r.cgst_paise, r.sgst_paise, r.igst_paise, r.total_paise]
    assert_adds_up r
  end

  test "exclusive adds GST on top" do
    intra = compute(100_000, include: false)
    assert_equal [100_000, 9_000, 9_000, 0, 118_000], [intra.taxable_paise, intra.cgst_paise, intra.sgst_paise, intra.igst_paise, intra.total_paise]
    inter = compute(100_000, include: false, place: "07")
    assert_equal [100_000, 0, 0, 18_000, 118_000], [inter.taxable_paise, inter.cgst_paise, inter.sgst_paise, inter.igst_paise, inter.total_paise]
  end

  test "not GST-registered gives a bill of supply with no tax at all" do
    [true, false].each do |include|
      r = compute(249_900, registered: false, include:)
      assert_equal "bill_of_supply", r.document_type
      assert_equal [249_900, 0, 0, 0, 249_900], [r.taxable_paise, r.cgst_paise, r.sgst_paise, r.igst_paise, r.total_paise]
    end
  end

  test "rounding to paise never breaks the total, CGST always equals SGST, and tax is within a paisa of exact" do
    (1..3000).step(7).each do |paise|
      amount = paise * 13 + 1
      [true, false].each do |include|
        %w[27 29].each do |place|
          r = compute(amount, include:, place:)
          assert_adds_up r
          assert_equal r.cgst_paise, r.sgst_paise
          assert_equal amount, r.total_paise if include
          exact_tax = include ? amount * 18.0 / 118 : amount * 0.18
          assert_in_delta exact_tax, r.gst_paise, 1.0, "amount #{amount} include=#{include} place=#{place}"
        end
      end
    end
  end

  test "odd paise are absorbed in the taxable value for an intra-state split" do
    r = compute(100_001)
    assert_equal r.cgst_paise, r.sgst_paise
    assert_equal 100_001, r.taxable_paise + (2 * r.cgst_paise)
  end

  test "an unknown buyer state is not treated as intra-state by accident" do
    r = compute(100_000, place: nil)
    assert_not r.intra_state
    assert_operator r.igst_paise, :>, 0
  end

  test "rejects a non-positive amount" do
    assert_raises(ArgumentError) { compute(0) }
  end
end
