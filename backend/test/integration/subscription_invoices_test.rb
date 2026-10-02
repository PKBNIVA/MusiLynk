require "test_helper"
require "minitest/mock"
require_relative "../support/seller_config"

# Billing profile + subscription invoice endpoints, the webhook that issues invoices, refunds, and
# the admin view/export.
class SubscriptionInvoicesTest < ActionDispatch::IntegrationTest
  include SellerConfig
  include ActiveJob::TestHelper

  WEBHOOK_SECRET = "invoice-webhook-secret"
  CHARGED_AT = Time.utc(2026, 10, 2, 6, 30).to_i

  setup do
    @env = %w[RAZORPAY_WEBHOOK_SECRET].to_h { [_1, ENV[_1]] }
    ENV["RAZORPAY_WEBHOOK_SECRET"] = WEBHOOK_SECRET
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    @email_env = ENV.to_h.slice("EMAIL_DELIVERY_WEBHOOK")
    ENV["EMAIL_DELIVERY_WEBHOOK"] = "https://email-hook.example.invalid/send"
    use_seller
    @user, @token = create_user("Meera Kapoor", "employer")
    @sub = Subscription.create!(user: @user, plan_code: "pro", provider: "razorpay", status: "pending", provider_subscription_id: "sub_inv_#{SecureRandom.hex(4)}")
  end

  teardown do
    Rails.cache = @original_cache
    ENV["EMAIL_DELIVERY_WEBHOOK"] = @email_env["EMAIL_DELIVERY_WEBHOOK"]
    ENV.delete("EMAIL_DELIVERY_WEBHOOK") unless @email_env.key?("EMAIL_DELIVERY_WEBHOOK")
    @env.each { |k, v| v.nil? ? ENV.delete(k) : ENV[k] = v }
    LegalConfig.reload!
  end

  def auth(token = @token) = { "Authorization" => "Bearer #{token}" }

  def create_user(name, role)
    user = User.create!(name:, email: "#{role}-#{SecureRandom.hex(5)}@example.com", password: "StrongPass123!", role:, status: "active", email_verified: true)
    user.create_profile!
    token = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(token), expires_at: 1.day.from_now)
    [user, token]
  end

  def business_params(**overrides)
    { buyerType: "business", legalName: "Kapoor Events LLP", gstin: "29AAGCB7383J1Z4", addressLine1: "4 Residency Road", city: "Bengaluru",
      stateCode: "29", postalCode: "560025", billingEmail: "accounts@kapoor.example", poReference: "PO-42" }.merge(overrides)
  end

  def charge!(payment_id: "pay_#{SecureRandom.hex(5)}", amount: 249_900, event_id: SecureRandom.hex(6))
    payload = { "event" => "subscription.charged", "created_at" => CHARGED_AT,
                "payload" => { "subscription" => { "entity" => { "id" => @sub.provider_subscription_id, "status" => "active", "current_start" => CHARGED_AT, "current_end" => CHARGED_AT + 30 * 86_400 } },
                               "payment" => { "entity" => { "id" => payment_id, "amount" => amount, "currency" => "INR", "status" => "captured", "created_at" => CHARGED_AT } } } }
    raw = JSON.generate(payload)
    post "/api/billing/webhook/razorpay", params: raw, headers: { "CONTENT_TYPE" => "application/json", "X-Razorpay-Event-Id" => event_id,
      "X-Razorpay-Signature" => OpenSSL::HMAC.hexdigest("SHA256", WEBHOOK_SECRET, raw) }
    assert_response :success, response.body
    payment_id
  end

  # --- profile endpoints -----------------------------------------------------------------

  test "profile endpoints need a signed-in hirer or musician" do
    get "/api/billing/profile"
    assert_response :unauthorized
    put "/api/billing/profile", params: business_params, as: :json
    assert_response :unauthorized
    admin = User.create!(name: "Admin Person", email: "admin-inv-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "admin", status: "active")
    token = SecureRandom.urlsafe_base64(48)
    admin.sessions.create!(token_digest: Digest::SHA256.hexdigest(token), expires_at: 1.day.from_now)
    get "/api/billing/profile", headers: auth(token)
    assert_response :forbidden
  end

  test "an account with no billing details gets the state list and defaults" do
    get "/api/billing/profile", headers: auth
    assert_response :success
    body = response.parsed_body
    assert_nil body["profile"]
    assert_equal @user.email, body.dig("defaults", "billingEmail")
    assert_includes body["states"], { "code" => "27", "name" => "Maharashtra" }
  end

  test "saving a business profile returns it, and an edit makes version 2" do
    put "/api/billing/profile", params: business_params, headers: auth, as: :json
    assert_response :success
    assert_equal 1, response.parsed_body.dig("profile", "version")
    assert_equal "Karnataka", response.parsed_body.dig("profile", "state")
    put "/api/billing/profile", params: business_params(city: "Mysuru"), headers: auth, as: :json
    assert_equal 2, response.parsed_body.dig("profile", "version")
    assert_equal 2, BillingProfile.where(user: @user).count
    assert_equal "billing.profile.save", AuditLog.where(actor: @user).order(:created_at).last.action
  end

  test "validation errors come back per field, in plain words" do
    put "/api/billing/profile", params: business_params(gstin: "29AAGCB7383J1Z5", postalCode: "12", stateCode: "27", legalName: ""), headers: auth, as: :json
    assert_response :unprocessable_content
    fields = response.parsed_body["fields"]
    assert_match(/last character|for Karnataka/, fields["gstin"].join)
    assert_equal ["Enter a 6-digit PIN code."], fields["postalCode"]
    assert_equal ["Enter the name to print on the invoice."], fields["legalName"]
    assert_nil BillingProfile.current_for(@user)
  end

  test "profile writes are rate limited" do
    31.times { put "/api/billing/profile", params: business_params, headers: auth, as: :json }
    assert_response :too_many_requests
  end

  test "one account cannot read or change another's profile" do
    other, other_token = create_user("Other Hirer", "employer")
    BillingProfile.save_for(other, business_params.transform_keys { _1.to_s.underscore }.symbolize_keys.merge(buyer_type: "business"))
    put "/api/billing/profile", params: business_params(legalName: "Mine Pvt Ltd", gstin: ""), headers: auth, as: :json
    assert_response :success
    get "/api/billing/profile", headers: auth(other_token)
    assert_equal "Kapoor Events LLP", response.parsed_body.dig("profile", "legalName")
  end

  # --- invoices issued by the webhook ----------------------------------------------------

  test "a subscription charge issues an invoice with the buyer's details, tax split and number" do
    put "/api/billing/profile", params: business_params, headers: auth, as: :json
    assert_enqueued_with(job: NotificationEmailJob) { charge! }

    invoice = TaxInvoice.find_by!(user: @user)
    assert_equal "MLK/2026-27/000001", invoice.invoice_number
    assert_equal "tax_invoice", invoice.document_type
    assert_equal [211_780, 0, 0, 38_120, 249_900], [invoice.taxable_paise, invoice.cgst_paise, invoice.sgst_paise, invoice.igst_paise, invoice.total_paise]
    assert_equal "29", invoice.place_of_supply_code
    assert_equal "29AAGCB7383J1Z4", invoice.buyer["gstin"]
    assert_equal "27AAPFU0939F1ZV", invoice.seller["gstin"]
    assert_equal "998314", invoice.sac_code
    assert_equal 1, invoice.buyer["profileVersion"]
    assert_equal BillingProfile.current_for(@user).id, invoice.billing_profile_id
  end

  test "a retried webhook for the same payment does not issue a second invoice" do
    pay = charge!
    charge!(payment_id: pay, event_id: SecureRandom.hex(6))
    assert_equal 1, TaxInvoice.where(user: @user).count
  end

  test "a later profile edit does not change an issued invoice" do
    put "/api/billing/profile", params: business_params, headers: auth, as: :json
    charge!
    put "/api/billing/profile", params: business_params(legalName: "Kapoor Events Pvt Ltd", city: "Mysuru"), headers: auth, as: :json
    invoice = TaxInvoice.find_by!(user: @user)
    assert_equal "Kapoor Events LLP", invoice.buyer["name"]
    assert_equal "Bengaluru", invoice.buyer["city"]
    assert_equal 1, invoice.buyer["profileVersion"]
    charge!
    newest = TaxInvoice.where(user: @user).order(:sequence_number).last
    assert_equal ["Kapoor Events Pvt Ltd", 2, "MLK/2026-27/000002"], [newest.buyer["name"], newest.buyer["profileVersion"], newest.invoice_number]
  end

  test "an account with no billing details gets a plain invoice for the account holder in the seller's state" do
    charge!
    invoice = TaxInvoice.find_by!(user: @user)
    assert_equal "Meera Kapoor", invoice.buyer["name"]
    assert_equal "individual", invoice.buyer["type"]
    assert_equal "27", invoice.place_of_supply_code
    assert_equal [19_060, 19_060, 0], [invoice.cgst_paise, invoice.sgst_paise, invoice.igst_paise]
  end

  test "an unregistered seller issues a bill of supply with no GST" do
    use_seller(gst_registered: false, gstin: "")
    charge!
    invoice = TaxInvoice.find_by!(user: @user)
    assert_equal "bill_of_supply", invoice.document_type
    assert_equal [249_900, 0, 0, 0], [invoice.taxable_paise, invoice.cgst_paise + invoice.sgst_paise, invoice.igst_paise, 0]
    assert_equal "", invoice.seller["gstin"]
  end

  test "a failed or zero charge issues nothing" do
    pay = "pay_zero"
    charge!(payment_id: pay, amount: 0)
    assert_equal 0, TaxInvoice.count
  end

  test "pending seller details: issued with a banner flag outside production, held back in production" do
    use_seller(legal_name: "[LEGAL ENTITY NAME]", address: "[REGISTERED ADDRESS]", state: "[STATE]", state_code: "[STATE CODE]", pan: "[PAN]", gstin: "")
    assert LegalConfig.invoice_seller_pending?
    charge!
    invoice = TaxInvoice.find_by!(user: @user)
    assert invoice.seller_pending?
    assert_equal "", invoice.seller["legalName"]

    get "/api/billing/invoices/#{invoice.id}", headers: auth
    assert_equal true, response.parsed_body.dig("invoice", "sellerPendingBanner")

    Rails.env.stub(:production?, true) do
      other_pay = charge!
      assert_nil TaxInvoice.find_by(provider_payment_id: other_pay)
      assert_equal 0, TaxInvoiceGenerator.catch_up!
    end
  end

  test "catch-up issues held-back invoices in charge order once the seller details are filled in" do
    use_seller(legal_name: "[LEGAL ENTITY NAME]", pan: "[PAN]")
    Rails.env.stub(:production?, true) { 2.times { charge! } }
    assert_equal 0, TaxInvoice.count

    use_seller
    assert_equal 2, TaxInvoiceGenerator.catch_up!
    assert_equal ["MLK/2026-27/000001", "MLK/2026-27/000002"], TaxInvoice.order(:sequence_number).pluck(:invoice_number)
    assert_equal 0, TaxInvoiceGenerator.catch_up!
  end

  # --- refunds ------------------------------------------------------------------------------

  test "a processed refund marks the invoice refunded with the refund reference" do
    pay = charge!
    payload = { "event" => "refund.processed", "created_at" => CHARGED_AT + 60,
                "payload" => { "refund" => { "entity" => { "id" => "rfnd_abc123", "payment_id" => pay, "amount" => 249_900 } } } }
    raw = JSON.generate(payload)
    post "/api/billing/webhook/razorpay", params: raw, headers: { "CONTENT_TYPE" => "application/json", "X-Razorpay-Event-Id" => "evt_refund",
      "X-Razorpay-Signature" => OpenSSL::HMAC.hexdigest("SHA256", WEBHOOK_SECRET, raw) }
    assert_response :success
    invoice = TaxInvoice.find_by!(provider_payment_id: pay)
    assert_equal ["full", "rfnd_abc123"], [invoice.refund_status, invoice.refund_reference]
    assert_equal "invoice_refund_recorded", BillingEvent.find_by(provider_event_id: "evt_refund").processing_result

    get "/api/billing/invoices", headers: auth
    assert_equal true, response.parsed_body["invoices"].first["refunded"]
    assert_equal "rfnd_abc123", response.parsed_body["invoices"].first["refundReference"]
  end

  # --- reading invoices ------------------------------------------------------------------------

  test "the owner lists and opens their invoice; amount in words and totals are in the document" do
    put "/api/billing/profile", params: business_params(stateCode: "27", gstin: "27AAPFU0939F1ZV"), headers: auth, as: :json
    assert_response :success
    charge!
    get "/api/billing/invoices", headers: auth
    assert_response :success
    row = response.parsed_body["invoices"].first
    assert_equal ["MLK/2026-27/000001", 249_900, "tax_invoice"], [row["invoiceNumber"], row["totalPaise"], row["documentType"]]

    get "/api/billing/invoices/#{row['id']}", headers: auth
    assert_response :success
    doc = response.parsed_body["invoice"]
    assert_equal "Indian Rupees Two Thousand Four Hundred Ninety Nine Only", doc["amountInWords"]
    assert_equal [19_060, 19_060, 0, 211_780], [doc["cgstPaise"], doc["sgstPaise"], doc["igstPaise"], doc["taxableValuePaise"]]
    assert_equal({ "code" => "27", "name" => "Maharashtra" }, doc["placeOfSupply"])
    assert_equal "27AAPFU0939F1ZV", doc.dig("buyer", "gstin")
    assert_equal 18, doc["ratePercent"]
  end

  test "another account's invoice is a 404, the same as one that does not exist" do
    charge!
    invoice = TaxInvoice.find_by!(user: @user)
    _other, other_token = create_user("Nosy Hirer", "employer")
    get "/api/billing/invoices/#{invoice.id}", headers: auth(other_token)
    assert_response :not_found
    get "/api/billing/invoices/inv_nope", headers: auth(other_token)
    assert_response :not_found
    get "/api/billing/invoices", headers: auth(other_token)
    assert_empty response.parsed_body["invoices"]
    get "/api/billing/invoices/#{invoice.id}"
    assert_response :unauthorized
  end

  # --- admin ---------------------------------------------------------------------------------------

  def admin_token
    @admin = User.create!(name: "Admin Accountant", email: "admin-acct-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "admin", status: "active")
    token = SecureRandom.urlsafe_base64(48)
    @admin.sessions.create!(token_digest: Digest::SHA256.hexdigest(token), expires_at: 1.day.from_now)
    token
  end

  test "the CSV export is admin-only and covers the date range with the accountant's columns" do
    put "/api/billing/profile", params: business_params(legalName: "=HYPERLINK(\"x\")"), headers: auth, as: :json
    charge!
    get "/api/admin/invoices/export.csv", params: { from: "2026-10-01", to: "2026-10-31" }, headers: auth
    assert_response :forbidden
    get "/api/admin/invoices/export.csv", params: { from: "2026-10-01", to: "2026-10-31" }
    assert_response :unauthorized

    token = admin_token
    get "/api/admin/invoices/export.csv", params: { from: "2026-10-01", to: "2026-10-31" }, headers: auth(token)
    assert_response :success
    assert_match(/text\/csv/, response.media_type + "/csv")
    lines = response.body.lines.map(&:chomp)
    assert_equal %w[invoice_number date buyer_name buyer_type gstin state taxable cgst sgst igst total document_type refund_status payment_reference], lines.first.delete('"').split(",")
    assert_equal 2, lines.size
    assert_includes lines.last, '"MLK/2026-27/000001","2026-10-02"'
    assert_includes lines.last, "\"'=HYPERLINK("
    assert_includes lines.last, '"2118.00"'.sub("2118.00", "2117.80")
    assert_includes lines.last, '"2499.00"'
    assert_equal "admin.invoices.export", AuditLog.where(actor: @admin).order(:created_at).last.action

    get "/api/admin/invoices/export.csv", params: { from: "2026-11-01", to: "2026-11-30" }, headers: auth(token)
    assert_equal 1, response.body.lines.size
  end

  test "the export range is validated" do
    token = admin_token
    get "/api/admin/invoices/export.csv", headers: auth(token)
    assert_response :bad_request
    get "/api/admin/invoices/export.csv", params: { from: "2026-10-31", to: "2026-10-01" }, headers: auth(token)
    assert_response :bad_request
    get "/api/admin/invoices/export.csv", params: { from: "2024-01-01", to: "2026-10-01" }, headers: auth(token)
    assert_response :bad_request
    get "/api/admin/invoices/export.csv", params: { from: "garbage", to: "2026-10-01" }, headers: auth(token)
    assert_response :bad_request
  end

  test "an admin sees an account's billing profile versions and invoices, read-only, and a seller warning" do
    put "/api/billing/profile", params: business_params, headers: auth, as: :json
    charge!
    token = admin_token
    get "/api/admin/users/#{@user.id}/billing", headers: auth(token)
    assert_response :success
    assert_equal 1, response.parsed_body.dig("profile", "version")
    assert_equal 1, response.parsed_body["invoices"].size
    get "/api/admin/users/#{@user.id}/billing", headers: auth
    assert_response :forbidden

    get "/api/admin/invoices", headers: auth(token)
    assert_equal [], response.parsed_body["sellerPending"]
    use_seller(legal_name: "[LEGAL ENTITY NAME]")
    get "/api/admin/invoices", headers: auth(token)
    assert_equal ["business.legal_name"], response.parsed_body["sellerPending"]
    get "/api/admin/operations", headers: auth(token)
    assert_equal ["business.legal_name"], response.parsed_body.dig("legal", "invoiceSellerPending")
  end

  test "account export includes billing profiles and invoices, and erasure removes saved profiles but keeps invoices" do
    put "/api/billing/profile", params: business_params, headers: auth, as: :json
    charge!
    export = AccountExport.new(@user).as_json.deep_symbolize_keys
    assert_equal 1, export[:billingProfiles].size
    assert_equal 1, export[:invoices].size
    @sub.update_columns(status: "cancelled")
    AccountErasure.new(@user).call!
    assert_equal 0, BillingProfile.where(user_id: @user.id).count
    assert_equal 1, TaxInvoice.where(user_id: @user.id).count
  end
end
