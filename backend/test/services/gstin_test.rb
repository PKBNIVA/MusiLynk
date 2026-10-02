require "test_helper"

class GstinTest < ActiveSupport::TestCase
  # Well-known real-format GSTINs (public company registrations); the last character is the checksum.
  VALID = %w[27AAPFU0939F1ZV 29AAGCB7383J1Z4 24AAACC1206D1ZM].freeze

  test "accepts real GSTINs with a correct check character" do
    VALID.each { |gstin| assert Gstin.valid?(gstin), "#{gstin} should be valid: #{Gstin.error_for(gstin)}" }
  end

  test "normalises case and spaces" do
    assert Gstin.valid?(" 27aapfu0939f1zv ")
    assert_equal "27AAPFU0939F1ZV", Gstin.normalize(" 27aapfu 0939f1zv")
  end

  test "rejects a wrong check character" do
    %w[27AAPFU0939F1ZW 29AAGCB7383J1Z5 24AAACC1206D1Z0].each do |gstin|
      assert_match(/last character/, Gstin.error_for(gstin), gstin)
    end
  end

  test "rejects a changed digit even when the shape is right" do
    assert_not Gstin.valid?("27AAPFU0938F1ZV")
    assert_not Gstin.valid?("28AAPFU0939F1ZV")
  end

  test "rejects bad structure" do
    ["", nil, "27AAPFU0939F1Z", "27AAPFU0939F1ZVV", "AAAAPFU0939F1ZV", "27AAPFU0939F0ZV", "27AAPFU0939F1XV", "27-AAPFU0939F1ZV"].each do |gstin|
      assert_match(/15-character/, Gstin.error_for(gstin).to_s, gstin.inspect)
    end
  end

  test "rejects an unknown state code" do
    assert_match(/state code/, Gstin.error_for("99AAPFU0939F1ZV"))
    assert_match(/state code/, Gstin.error_for("00AAPFU0939F1ZV"))
  end

  test "reads the state code and PAN out of a GSTIN" do
    assert_equal "27", Gstin.state_code("27AAPFU0939F1ZV")
    assert_equal "AAPFU0939F", Gstin.pan("27AAPFU0939F1ZV")
  end

  test "the state list has every state and union territory with unique two-digit codes" do
    assert_equal "Maharashtra", IndianStates.name("27")
    assert_equal "Karnataka", IndianStates.name("29")
    assert_equal "Delhi", IndianStates.name("07")
    assert_equal "27", IndianStates.code_for_name(" maharashtra ")
    assert_operator IndianStates::STATES.size, :>=, 36
    assert IndianStates::STATES.keys.all? { _1.match?(/\A\d{2}\z/) }
    assert_not IndianStates.valid?("99")
  end
end
