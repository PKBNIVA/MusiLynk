# Indian states and union territories with their GST state codes (the first two digits of a GSTIN).
# Used for the billing address, the place-of-supply decision and the GSTIN state check.
module IndianStates
  STATES = {
    "01" => "Jammu and Kashmir", "02" => "Himachal Pradesh", "03" => "Punjab", "04" => "Chandigarh", "05" => "Uttarakhand",
    "06" => "Haryana", "07" => "Delhi", "08" => "Rajasthan", "09" => "Uttar Pradesh", "10" => "Bihar", "11" => "Sikkim",
    "12" => "Arunachal Pradesh", "13" => "Nagaland", "14" => "Manipur", "15" => "Mizoram", "16" => "Tripura",
    "17" => "Meghalaya", "18" => "Assam", "19" => "West Bengal", "20" => "Jharkhand", "21" => "Odisha", "22" => "Chhattisgarh",
    "23" => "Madhya Pradesh", "24" => "Gujarat", "26" => "Dadra and Nagar Haveli and Daman and Diu", "27" => "Maharashtra",
    "29" => "Karnataka", "30" => "Goa", "31" => "Lakshadweep", "32" => "Kerala", "33" => "Tamil Nadu", "34" => "Puducherry",
    "35" => "Andaman and Nicobar Islands", "36" => "Telangana", "37" => "Andhra Pradesh", "38" => "Ladakh", "97" => "Other Territory"
  }.freeze

  module_function

  def name(code) = STATES[code.to_s]
  def valid?(code) = STATES.key?(code.to_s)

  # The code for a state's name ("maharashtra", " Maharashtra "), or nil.
  def code_for_name(name)
    key = name.to_s.strip.downcase
    STATES.find { |_, state| state.downcase == key }&.first
  end

  def all = STATES.map { |code, state| { code:, name: state } }
end
