require "test_helper"

class AdminAiTest < ActionDispatch::IntegrationTest
  setup do
    @admin = create_user("AI Admin", "ai-admin@example.com", "admin")
    @user = create_user("AI Ledger User", "ai-ledger-user@example.com", "jobseeker")
    @token = session_for(@admin)
  end

  test "non-admin cannot reach any admin AI route" do
    get "/api/admin/ai/costs", headers: auth(session_for(@user))
    assert_response :forbidden
  end

  test "costs reports this month's spend by task and tier" do
    AiCreditLedger.create!(account_type: "user", account_id: @user.id, delta: -1, reason: "usage", task: "post_caption",
      period: AiCredits.current_period, cost_inr: 2.5, metadata: { "tier" => "free" })

    get "/api/admin/ai/costs", headers: auth(@token)
    assert_response :success
    body = response.parsed_body
    assert_equal 2.5, body["totalSpendInr"].to_f
    assert_equal 2.5, body["freeTierSpendInr"].to_f
    assert_equal 2.5, body.dig("byTask", "post_caption").to_f
  end

  test "admin grants credits with an audit entry, idempotent per call" do
    post "/api/admin/ai/grants", params: { accountType: "user", accountId: @user.id, credits: 50, note: "goodwill" }, headers: auth(@token), as: :json
    assert_response :success
    resolution = AiCreditAccount::Resolution.new(account_type: "user", account_id: @user.id, plan_code: "free", ai_plus_active: false)
    assert_equal 50, AiCredits.balance(resolution.account_type, resolution.account_id)
    assert AuditLog.exists?(action: "admin.ai.grant", entity_id: response.parsed_body.dig("ledgerEntry", "id"))
  end

  test "grants rejects a non-positive credit amount" do
    post "/api/admin/ai/grants", params: { accountType: "user", accountId: @user.id, credits: 0 }, headers: auth(@token), as: :json
    assert_response :bad_request
  end

  test "usage reads back an account's balance and recent activity" do
    AiCreditLedger.create!(account_type: "user", account_id: @user.id, delta: 20, reason: "monthly_allowance", period: AiCredits.current_period)
    get "/api/admin/ai/usage", params: { accountType: "user", accountId: @user.id }, headers: auth(@token)
    assert_response :success
    assert_equal 20, response.parsed_body["balance"]
  end

  private

  def create_user(name, email, role)
    User.create!(name:, email:, password: "StrongPass123!", role:, status: "active", email_verified: true).tap { _1.create_profile! unless role == "admin" }
  end

  def auth(token) = { "Authorization" => "Bearer #{token}" }

  def session_for(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    raw
  end
end
