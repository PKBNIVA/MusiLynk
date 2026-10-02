require "test_helper"

class AmountInWordsTest < ActiveSupport::TestCase
  test "uses lakh and crore" do
    assert_equal "Indian Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only", AmountInWords.paise(12_345_650)
    assert_equal "Indian Rupees One Crore Only", AmountInWords.paise(1_00_00_000 * 100)
    assert_equal "Indian Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only", AmountInWords.paise(12_34_56_789 * 100)
    assert_equal "Indian Rupees Ten Lakh Only", AmountInWords.paise(10_00_000 * 100)
  end

  test "plan prices" do
    assert_equal "Indian Rupees Two Thousand Four Hundred Ninety Nine Only", AmountInWords.paise(249_900)
    assert_equal "Indian Rupees Twenty Four Thousand Nine Hundred Ninety Only", AmountInWords.paise(2_499_000)
    assert_equal "Indian Rupees Fifty Nine Thousand Nine Hundred Ninety Only", AmountInWords.paise(5_999_000)
  end

  test "small and edge amounts" do
    assert_equal "Indian Rupees Five Paise Only", AmountInWords.paise(5)
    assert_equal "Indian Rupees One and One Paise Only", AmountInWords.paise(101)
    assert_equal "Indian Rupees Zero Only", AmountInWords.paise(0)
    assert_equal "Indian Rupees Nineteen Only", AmountInWords.paise(1900)
    assert_equal "Indian Rupees One Hundred Only", AmountInWords.paise(10_000)
    assert_equal "Indian Rupees One Thousand and Ninety Nine Paise Only", AmountInWords.paise(100_099)
    assert_raises(ArgumentError) { AmountInWords.paise(-1) }
  end
end
