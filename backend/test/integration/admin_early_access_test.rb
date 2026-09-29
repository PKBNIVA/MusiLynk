require "test_helper"

class AdminEarlyAccessTest < ActionDispatch::IntegrationTest
  setup do
    @admin = create_user("Early Access Admin", "early-access-admin@example.com", "admin")
    @employer = create_user("Early Access Employer", "early-access-employer@example.com", "employer")
    @jobseeker = create_user("Early Access Jobseeker", "early-access-jobseeker@example.com", "jobseeker")
    @admin_token = session_for(@admin)
  end

  test "non-admin cannot grant or revoke early access" do
    post "/api/admin/users/#{@employer.id}/early-access", headers: auth(session_for(@employer))
    assert_response :forbidden

    delete "/api/admin/users/#{@employer.id}/early-access", headers: auth(session_for(@employer))
    assert_response :forbidden
  end

  test "grants Early Access Pro to an employer, queues the email, and audits it" do
    with_env("EMAIL_DELIVERY_WEBHOOK" => "https://email-hook.example.invalid/send") do
      post "/api/admin/users/#{@employer.id}/early-access", headers: auth(@admin_token)
    end
    assert_response :created

    sub = Subscription.find(response.parsed_body.fetch("id"))
    assert_enqueued_with(job: NotificationEmailJob, args: [@employer.id, "early_access_granted", { "until" => sub.trial_ends_at.strftime("%d %b %Y") }])
    assert_equal "pro", sub.plan_code
    assert_equal "early_access", sub.status
    assert_equal "internal", sub.provider
    assert sub.early_access?
    assert_in_delta 90.days.from_now.to_i, sub.trial_ends_at.to_i, 5
    assert_equal "pro", Entitlements.for(@employer).plan_code
    assert AuditLog.exists?(action: "admin.early_access.grant", entity_id: sub.id)
  end

  test "refuses to grant early access to a jobseeker" do
    post "/api/admin/users/#{@jobseeker.id}/early-access", headers: auth(@admin_token)
    assert_response :unprocessable_content
  end

  test "refuses to grant early access once seats are exhausted" do
    original = BillingConfig.method(:early_access_seats)
    BillingConfig.define_singleton_method(:early_access_seats) { 1 }
    begin
      other = create_user("Other Early Access Employer", "other-early-access@example.com", "employer")
      Subscription.create!(user: other, plan_code: "pro", provider: "internal", status: "early_access",
        early_access: true, trial_started_at: Time.current, trial_ends_at: 90.days.from_now)

      post "/api/admin/users/#{@employer.id}/early-access", headers: auth(@admin_token)
      assert_response :conflict
      assert_equal "EARLY_ACCESS_SEATS_EXHAUSTED", response.parsed_body["code"]
    ensure
      BillingConfig.define_singleton_method(:early_access_seats, original)
    end
  end

  test "refuses to grant early access to an account with an active paid subscription" do
    Subscription.create!(user: @employer, plan_code: "pro", provider: "razorpay", status: "active", provider_subscription_id: "sub_paid")

    post "/api/admin/users/#{@employer.id}/early-access", headers: auth(@admin_token)
    assert_response :conflict
    assert_equal "ALREADY_SUBSCRIBED", response.parsed_body["code"]
  end

  test "revokes an early access grant, dropping entitlements back to free" do
    post "/api/admin/users/#{@employer.id}/early-access", headers: auth(@admin_token)
    assert_response :created

    delete "/api/admin/users/#{@employer.id}/early-access", headers: auth(@admin_token)
    assert_response :success

    sub = Subscription.find(response.parsed_body["id"] || Subscription.where(user: @employer).order(created_at: :desc).first.id)
    assert_equal "cancelled", sub.reload.status
    assert_equal "free", Entitlements.for(@employer).plan_code
    assert AuditLog.exists?(action: "admin.early_access.revoke")
  end

  test "revoking with no active grant answers not found" do
    delete "/api/admin/users/#{@employer.id}/early-access", headers: auth(@admin_token)
    assert_response :not_found
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

  def with_env(values)
    previous = values.keys.to_h { [_1, ENV[_1]] }
    values.each { |k, v| ENV[k] = v }
    yield
  ensure
    previous.each { |k, v| v.nil? ? ENV.delete(k) : ENV[k] = v }
  end
end
