require "test_helper"

class BillingProfileTest < ActiveSupport::TestCase
  setup { @user = User.create!(name: "Asha Rao", email: "asha-bp-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "employer", status: "active") }

  def business(**overrides)
    { buyer_type: "business", legal_name: "Kapoor Events LLP", gstin: "27AAPFU0939F1ZV", address_line1: "12 Linking Road", city: "Mumbai",
      state_code: "27", postal_code: "400050", billing_email: "accounts@kapoor.example" }.merge(overrides)
  end

  def individual(**overrides)
    { buyer_type: "individual", legal_name: "Asha Rao", address_line1: "5 MG Road", city: "Pune", state_code: "27", postal_code: "411001" }.merge(overrides)
  end

  test "an individual needs a name, address, state and PIN, and the email defaults to the account email" do
    profile = BillingProfile.save_for(@user, individual)
    assert profile.persisted?
    assert_equal @user.email, profile.billing_email
    assert_equal 1, profile.version
    assert profile.current
    assert_equal "India", profile.country
  end

  test "an individual's GSTIN and PAN are dropped" do
    profile = BillingProfile.save_for(@user, individual(gstin: "27AAPFU0939F1ZV", pan: "AAPFU0939F"))
    assert_nil profile.gstin
    assert_nil profile.pan
  end

  test "a business may leave GSTIN and PAN blank" do
    profile = BillingProfile.save_for(@user, business(gstin: "", pan: ""))
    assert profile.persisted?
    assert_nil profile.gstin
  end

  test "a business GSTIN is checked for shape and checksum" do
    bad = BillingProfile.save_for(@user, business(gstin: "27AAPFU0939F1ZW"))
    assert_not bad.persisted?
    assert_match(/Check the last character/, bad.errors[:gstin].to_sentence)
    short = BillingProfile.save_for(@user, business(gstin: "27AAPFU"))
    assert_match(/15-character/, short.errors[:gstin].to_sentence)
    assert_nil BillingProfile.current_for(@user)
  end

  test "the GSTIN state code must match the chosen state" do
    mismatch = BillingProfile.save_for(@user, business(state_code: "29"))
    assert_not mismatch.persisted?
    assert_match(/for Maharashtra, but you chose Karnataka/, mismatch.errors[:gstin].to_sentence)
  end

  test "a PAN is format checked, and must match the PAN inside a GSTIN" do
    assert_match(/10-character PAN/, BillingProfile.save_for(@user, business(gstin: "", pan: "ABC123")).errors[:pan].to_sentence)
    assert BillingProfile.save_for(@user, business(gstin: "", pan: "abcde1234f")).persisted?
    assert_match(/does not match/, BillingProfile.save_for(@user, business(pan: "ABCDE1234F")).errors[:pan].to_sentence)
    assert BillingProfile.save_for(@user, business(pan: "AAPFU0939F")).persisted?
  end

  test "address fields are validated" do
    profile = BillingProfile.save_for(@user, individual(address_line1: "", city: "", postal_code: "0123", state_code: "99", billing_email: "nope", legal_name: ""))
    assert_not profile.persisted?
    %i[address_line1 city postal_code state_code billing_email legal_name].each { assert profile.errors[_1].any?, _1.to_s }
    assert_equal ["Enter a 6-digit PIN code."], profile.errors[:postal_code]
    assert_equal ["Choose your state."], profile.errors[:state_code]
  end

  test "PO reference allows letters, numbers and common separators only" do
    assert BillingProfile.save_for(@user, business(po_reference: "PO-2026/0042 #A")).persisted?
    assert_not BillingProfile.save_for(@user, business(po_reference: "<script>")).persisted?
  end

  test "an edit adds a new version and keeps the old one" do
    first = BillingProfile.save_for(@user, business)
    second = BillingProfile.save_for(@user, business(city: "Navi Mumbai"))
    assert_equal [1, 2], [first.version, second.version]
    assert_equal second.id, BillingProfile.current_for(@user).id
    assert_not first.reload.current
    assert_equal "Mumbai", first.city
    assert_equal 2, BillingProfile.where(user: @user).count
    assert_equal 1, BillingProfile.where(user: @user, current: true).count
  end

  test "saving the same details again does not add a version" do
    first = BillingProfile.save_for(@user, business)
    again = BillingProfile.save_for(@user, business)
    assert_equal first.id, again.id
    assert_equal 1, BillingProfile.where(user: @user).count
  end

  test "an invalid edit leaves the current version alone" do
    first = BillingProfile.save_for(@user, business)
    BillingProfile.save_for(@user, business(postal_code: "1"))
    assert_equal first.id, BillingProfile.current_for(@user).id
    assert_equal 1, BillingProfile.where(user: @user).count
  end

  test "only one version can be current at the database level" do
    BillingProfile.save_for(@user, business)
    assert_raises(ActiveRecord::RecordNotUnique) do
      BillingProfile.new(business.merge(user: @user, version: 9, current: true, country: "India")).save!(validate: false)
    end
  end

  test "the snapshot carries the version and the printed details" do
    snapshot = BillingProfile.save_for(@user, business(po_reference: "PO-7")).snapshot
    assert_equal "Kapoor Events LLP", snapshot[:name]
    assert_equal "Maharashtra", snapshot[:state]
    assert_equal "PO-7", snapshot[:poReference]
    assert_equal 1, snapshot[:profileVersion]
  end
end
