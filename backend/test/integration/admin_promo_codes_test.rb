require "test_helper"
require_relative "../support/promo_code_helpers"

class AdminPromoCodesTest < ActionDispatch::IntegrationTest
  include PromoCodeHelpers

  setup do
    @admin, @admin_token = create_person("Codes Admin", "admin")
    @employer, @employer_token = create_person("Codes Employer")
  end

  def admin_headers = bearer(@admin_token)

  def create_code(**body)
    post "/api/admin/promo-codes", params: body, headers: admin_headers, as: :json
  end

  test "only admins can use any of the routes" do
    promo = make_code(code: "LOCKED")
    [[:get, "/api/admin/promo-codes"], [:post, "/api/admin/promo-codes"], [:patch, "/api/admin/promo-codes/#{promo.id}"],
     [:get, "/api/admin/promo-codes/#{promo.id}/redemptions"], [:get, "/api/admin/promo-codes/export.csv"]].each do |verb, path|
      send(verb, path, headers: bearer(@employer_token), as: :json)
      assert_response :forbidden, "#{verb} #{path}"
      send(verb, path, as: :json)
      assert_response :unauthorized, "#{verb} #{path} signed out"
    end
  end

  test "creates a single vanity discount code, upper-cased, and audits it" do
    create_code(kind: "discount_percent", code: "mumbai50", percentOff: 20, durationPeriods: 2, planCodes: ["pro"], intervals: ["monthly"], maxRedemptions: 100,
      razorpayOfferId: " offer_abc ", notes: "Mumbai launch", expiresAt: 30.days.from_now.iso8601)
    assert_response :created, response.body
    body = response.parsed_body.fetch("code")
    assert_equal ["MUMBAI50", "discount_percent", 20, 2, ["pro"], ["monthly"], 100, "offer_abc", @admin.id],
      body.values_at("code", "kind", "percentOff", "durationPeriods", "planCodes", "intervals", "maxRedemptions", "razorpayOfferId", "createdById")
    assert_equal false, body["needsOffer"]
    assert AuditLog.exists?(action: "admin.promo_code.create", entity_id: body["id"], actor_id: @admin.id)
  end

  test "creates extended-trial and early-access codes" do
    create_code(kind: "extended_trial", code: "TRIAL90", trialDays: 90)
    assert_response :created
    assert_equal 90, response.parsed_body.dig("code", "trialDays")
    create_code(kind: "early_access", code: "EARLYONE")
    assert_response :created
  end

  test "validation failures are 422 with the reason" do
    create_code(kind: "discount_percent", code: "BADPCT", percentOff: 150)
    assert_response :unprocessable_content
    assert_match(/Percent off/, response.parsed_body["error"])
    create_code(kind: "extended_trial", code: "NOTRIAL")
    assert_response :unprocessable_content
    create_code(kind: "discount_percent", code: "a", percentOff: 10)
    assert_response :unprocessable_content
    create_code(kind: "discount_percent", code: "GOODONE", percentOff: 10, planCodes: ["platinum"])
    assert_response :unprocessable_content
    create_code(kind: "referral", code: "REFERRAL1")
    assert_response :unprocessable_content
    assert_equal "INVALID_KIND", response.parsed_body["code"]
    create_code(kind: "discount_percent", code: "GOODONE", percentOff: 10)
    create_code(kind: "discount_percent", code: "goodone", percentOff: 10)
    assert_response :unprocessable_content, "codes are unique case-insensitively"
  end

  test "generates a batch with a shared batch id and the configured format" do
    create_code(kind: "discount_percent", generate: 12, percentOff: 15, notes: "Podcast run")
    assert_response :created, response.body
    body = response.parsed_body
    assert_equal 12, body["codes"].size
    assert_equal 12, body["codes"].pluck("code").uniq.size
    assert(body["codes"].all? { _1["code"].match?(/\AMUSILYNK-[A-HJ-NP-Z2-9]{6}\z/) && _1["batchId"] == body["batchId"] })
    assert AuditLog.exists?(action: "admin.promo_code.generate")
  end

  test "batch size and shared settings are validated before anything is written" do
    create_code(kind: "discount_percent", generate: 0, percentOff: 15)
    assert_response :unprocessable_content
    create_code(kind: "discount_percent", generate: 501, percentOff: 15)
    assert_response :unprocessable_content
    create_code(kind: "discount_percent", generate: "abc", percentOff: 15)
    assert_response :unprocessable_content
    create_code(kind: "discount_percent", generate: 5, percentOff: 500)
    assert_response :unprocessable_content
    assert_equal 0, PromoCode.count
  end

  test "an exhausted code space is a clean conflict" do
    PromoCodes::Generator.stub(:create_batch, ->(*) { raise PromoCodes::Generator::Exhausted, "no room" }) do
      create_code(kind: "early_access", generate: 3)
    end
    assert_response :conflict
    assert_equal "CODE_SPACE_EXHAUSTED", response.parsed_body["code"]
  end

  test "the list is paginated and filters by kind, active state, batch and search, hiding user referral codes" do
    make_code(code: "ALPHA10", notes: "spring push")
    make_code(code: "BETA20", active: false, batch_id: "b-1")
    make_code(kind: "extended_trial", code: "GAMMA30")
    PromoCodes::Generator.referral_for(@employer)

    get "/api/admin/promo-codes", headers: admin_headers
    body = response.parsed_body
    assert_equal %w[ALPHA10 BETA20 GAMMA30].sort, body["codes"].pluck("code").sort
    assert_equal [1, 50, 3], body.values_at("page", "perPage", "total")

    get "/api/admin/promo-codes?kind=extended_trial", headers: admin_headers
    assert_equal ["GAMMA30"], response.parsed_body["codes"].pluck("code")
    get "/api/admin/promo-codes?kind=referral", headers: admin_headers
    assert_equal [@employer.id], response.parsed_body["codes"].pluck("ownerUserId")
    get "/api/admin/promo-codes?active=false", headers: admin_headers
    assert_equal ["BETA20"], response.parsed_body["codes"].pluck("code")
    get "/api/admin/promo-codes?batchId=b-1", headers: admin_headers
    assert_equal ["BETA20"], response.parsed_body["codes"].pluck("code")
    get "/api/admin/promo-codes?q=spring", headers: admin_headers
    assert_equal ["ALPHA10"], response.parsed_body["codes"].pluck("code")
    get "/api/admin/promo-codes?q=alp%25", headers: admin_headers
    assert_empty response.parsed_body["codes"]
    get "/api/admin/promo-codes?perPage=2&page=2", headers: admin_headers
    assert_equal [2, 2, 3], response.parsed_body.values_at("page", "perPage", "total")
    assert_equal 1, response.parsed_body["codes"].size
  end

  test "the list flags discount codes that live billing cannot honour, and reports the programme read-only" do
    make_code(code: "NEEDSIT")
    with_env("RAZORPAY_KEY_ID" => "rzp_test_x", "RAZORPAY_SIMULATOR" => nil) do
      get "/api/admin/promo-codes", headers: admin_headers
    end
    body = response.parsed_body
    assert_equal true, body["codes"].first["needsOffer"]
    assert_equal true, body.dig("programme", "offerRequired")
    assert_equal({ "enabled" => true, "refereePercentOff" => 20, "refereeDurationPeriods" => 3, "referrerRewardDays" => 30, "referrerRewardCap" => 6, "offerConfigured" => false },
      body.dig("programme", "referral"))
    assert_equal "MUSILYNK-{6}", body.dig("programme", "codeFormat")
    assert_match(/billing\.yml/, body.dig("programme", "editNote"))

    get "/api/admin/promo-codes", headers: admin_headers
    assert_equal false, response.parsed_body["codes"].first["needsOffer"], "the mock and the simulator apply the percentage themselves"
  end

  test "update changes only the editable fields and audits it" do
    promo = make_code(code: "EDITME")
    patch "/api/admin/promo-codes/#{promo.id}", params: { active: false, notes: "Paused", maxRedemptions: 5, max_redemptions: 5, razorpayOfferId: "x", razorpay_offer_id: "offer_new",
      percentOff: 99, code: "HACKED", expires_at: 2.days.from_now.iso8601 }, headers: admin_headers, as: :json
    assert_response :success, response.body
    promo.reload
    assert_equal ["EDITME", 20, false, "Paused", 5, "offer_new"], [promo.code, promo.percent_off, promo.active, promo.notes, promo.max_redemptions, promo.razorpay_offer_id]
    assert AuditLog.exists?(action: "admin.promo_code.update", entity_id: promo.id)

    patch "/api/admin/promo-codes/#{promo.id}", params: { percentOff: 50 }, headers: admin_headers, as: :json
    assert_response :bad_request
    patch "/api/admin/promo-codes/#{promo.id}", params: { max_redemptions: 0 }, headers: admin_headers, as: :json
    assert_response :unprocessable_content
  end

  test "a referral code's offer cannot be edited per code" do
    referral = PromoCodes::Generator.referral_for(@employer)
    patch "/api/admin/promo-codes/#{referral.id}", params: { razorpay_offer_id: "offer_x" }, headers: admin_headers, as: :json
    assert_response :unprocessable_content
    patch "/api/admin/promo-codes/#{referral.id}", params: { active: false }, headers: admin_headers, as: :json
    assert_response :success
  end

  test "the redemptions list shows who used the code and any referrer reward" do
    referral = PromoCodes::Generator.referral_for(@employer)
    referee, = create_person("Referred Hirer")
    redemption = PromoRedemption.create!(promo_code: referral, user: referee, kind: "referral", percent_off: 20, redeemed_at: Time.current)
    BillingCredit.create!(user: @employer, days: 30, reason: "referral_reward", promo_redemption: redemption, applied_at: Time.current)

    get "/api/admin/promo-codes/#{referral.id}/redemptions", headers: admin_headers
    assert_response :success
    row = response.parsed_body["redemptions"].sole
    assert_equal [referee.email, "referral", 20], row.values_at("email", "kind", "percentOff")
    assert_equal 30, row.dig("referrerReward", "days")
    assert_equal @employer.id, row.dig("referrerReward", "userId")
    assert_equal 1, response.parsed_body["total"]
  end

  test "the CSV export covers a batch or everything, quotes cells and defuses formulas" do
    create_code(kind: "early_access", generate: 3, notes: "=HYPERLINK(\"x\")")
    batch_id = response.parsed_body["batchId"]
    make_code(code: "OTHER10")
    PromoCodes::Generator.referral_for(@employer)

    get "/api/admin/promo-codes/export.csv?batchId=#{batch_id}", headers: admin_headers
    assert_response :success
    assert_match(%r{\Atext/csv}, response.media_type + "")
    assert_includes response.headers["Content-Disposition"], "promo-codes-#{batch_id}.csv"
    lines = response.body.lines
    assert_equal '"code","kind","percent_off","duration_periods","trial_days","plan_codes","intervals","razorpay_offer_id","max_redemptions","redemptions_count","per_user_limit","starts_at","expires_at","active","batch_id","notes"', lines.first.chomp
    assert_equal 4, lines.size
    assert_includes lines.second, "\"'=HYPERLINK(\"\"x\"\")\""

    get "/api/admin/promo-codes/export.csv", headers: admin_headers
    assert_equal 5, response.body.lines.size, "all admin codes, without user referral codes"
    assert AuditLog.exists?(action: "admin.promo_code.export")
  end
end
