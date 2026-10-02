# GSTIN validation: the 15-character structure and the check character (a base-36 weighted
# checksum over the first 14 characters, as published by GSTN). Nothing here looks the number up
# on the GST portal, so a valid GSTIN only means "well-formed", not "registered".
module Gstin
  FORMAT = /\A(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])\z/
  ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".freeze

  module_function

  def normalize(value) = value.to_s.strip.upcase.delete(" ")

  def check_character(first_fourteen)
    sum = first_fourteen.each_char.each_with_index.sum do |char, index|
      product = ALPHABET.index(char) * (index.even? ? 1 : 2)
      (product / 36) + (product % 36)
    end
    ALPHABET[(36 - (sum % 36)) % 36]
  end

  # nil when valid, otherwise the plain-language reason.
  def error_for(value)
    gstin = normalize(value)
    return "Enter a 15-character GSTIN, like 27AAPFU0939F1ZV." unless gstin.match?(FORMAT)
    return "The first two digits of this GSTIN are not a state code." unless IndianStates.valid?(gstin[0, 2])
    return "This GSTIN does not look right. Check the last character." unless check_character(gstin[0, 14]) == gstin[14]

    nil
  end

  def valid?(value) = error_for(value).nil?
  def state_code(value) = normalize(value)[0, 2]
  def pan(value) = normalize(value)[2, 10]
end
