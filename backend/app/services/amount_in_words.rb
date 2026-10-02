# Rupee amounts in words using the Indian system (thousand, lakh, crore), as printed on invoices:
# 1_23_456.50 rupees -> "Indian Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Fifty Paise Only".
module AmountInWords
  ONES = %w[Zero One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen].freeze
  TENS = %w[_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety].freeze

  module_function

  def paise(total_paise)
    paise = Integer(total_paise)
    raise ArgumentError, "amount cannot be negative" if paise.negative?

    rupees, remainder = paise.divmod(100)
    parts = []
    parts << words(rupees) if rupees.positive? || remainder.zero?
    parts << "#{words(remainder)} Paise" if remainder.positive?
    "Indian Rupees #{parts.join(' and ')} Only"
  end

  def words(number)
    return ONES[number] if number < 20
    return TENS[number / 10] + (number % 10 == 0 ? "" : " #{ONES[number % 10]}") if number < 100
    return "#{ONES[number / 100]} Hundred#{number % 100 == 0 ? '' : " #{words(number % 100)}"}" if number < 1000

    [[10_000_000, "Crore"], [100_000, "Lakh"], [1000, "Thousand"]].each do |size, label|
      next if number < size

      head, tail = number.divmod(size)
      return "#{words(head)} #{label}#{tail.zero? ? '' : " #{words(tail)}"}"
    end
  end
end
