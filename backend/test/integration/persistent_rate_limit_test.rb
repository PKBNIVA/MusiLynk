require "test_helper"

# Production keeps rate-limit counters in Solid Cache (PostgreSQL) so they are shared by
# every process and survive restarts. A fresh store instance stands in for a restarted process.
class PersistentRateLimitTest < ActionDispatch::IntegrationTest
  PASSWORD = "StrongPass123!".freeze

  setup do
    @original_cache = Rails.cache
    Rails.cache = new_store
    User.create!(name: "Throttle Target", email: "target@example.com", password: PASSWORD, role: "jobseeker", status: "active")
  end

  teardown do
    Rails.cache = @original_cache
  end

  test "login failure throttles survive a restart" do
    AuthController::LOGIN_FAILURES_PER_EMAIL_AND_IP.times do
      login("target@example.com", "wrong-password")
      assert_response :unauthorized
    end

    Rails.cache = new_store

    login("target@example.com", PASSWORD)
    assert_response :too_many_requests
  end

  test "counters are shared between processes and expire with their window" do
    first, second = new_store, new_store
    assert_equal 1, first.increment("rate:test", 1, expires_in: 1.minute)
    assert_equal 2, second.increment("rate:test", 1, expires_in: 1.minute)
    assert_equal 2, first.increment("rate:test", 0, expires_in: 1.minute)

    travel 1.minute + 1.second do
      assert_equal 1, second.increment("rate:test", 1, expires_in: 1.minute)
    end
  end

  private

  def new_store = ActiveSupport::Cache.lookup_store(:solid_cache_store, namespace: "persistent-rate-limit-test")

  def login(email, password)
    post "/api/auth/login", params: { email:, password: }, env: { "REMOTE_ADDR" => "198.51.100.7" }, as: :json
  end
end
