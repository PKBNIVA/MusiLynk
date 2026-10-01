require "test_helper"
require "minitest/mock"

# GET /api/public/talent maps up to 24 people through public_profile. For verified people that used to
# cost three more queries each (verification summary, urgent fills, completed bookings), so the page
# every landing visitor loads ran ~95 queries. The tier and the summary are now batched with the stats.
class PublicTalentQueryBudgetTest < ActionDispatch::IntegrationTest
  setup { @seq = 0 }

  def verified_musician(name)
    @seq += 1
    user = User.create!(name:, email: "tqb-#{@seq}-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", profile_complete: true)
    user.create_profile!(verified: true, headline: "Drummer", location: "Mumbai")
    VerificationRequest.create!(user:, kind: "professional", status: "approved", checks: %w[identity work_links], reviewed_at: Time.current)
    user
  end

  def query_count
    count = 0
    callback = ->(*, payload) { count += 1 unless %w[SCHEMA TRANSACTION].include?(payload[:name]) || payload[:sql].match?(/\A(BEGIN|COMMIT|SAVEPOINT|RELEASE)/) }
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { get "/api/public/talent?limit=24" }
    assert_response :success
    count
  end

  test "the directory page runs the same number of queries for 2 verified people as for 12" do
    2.times { |i| verified_musician("Budget Few #{i}") }
    few = query_count
    10.times { |i| verified_musician("Budget Many #{i}") }
    many = query_count
    assert_equal few, many, "query count grew from #{few} to #{many} with the number of verified people (N+1)"
    talent = response.parsed_body["talent"]
    assert_equal 12, talent.length
    assert(talent.all? { _1["verification"]["checks"] == %w[identity work_links] })
    assert(talent.all? { _1["verificationTier"] == "verified" })
  end

  test "Verification::Tier.batch agrees with the per-user tier" do
    pro = verified_musician("Budget Pro")
    plain = verified_musician("Budget Plain")
    unverified = User.create!(name: "Budget Unverified", email: "tqb-u-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", profile_complete: true)
    unverified.create_profile!
    employer = User.create!(name: "Budget Hirer", email: "tqb-e-#{SecureRandom.hex(4)}@example.com", password: "StrongPass123!", role: "employer", status: "active", profile_complete: true)
    employer.create_profile!
    Review.create!(employer: pro, author: employer, rating: 5, body: "Great session player, on time and prepared.", status: "published")
    users = [pro, plain, unverified].map { User.includes(:profile).find(_1.id) }
    # One published review and no completed work required, so `pro` qualifies and `plain` (no review) does not.
    Verification::Config.stub(:pro, { min_completed: 0, min_reviews: 1 }) do
      batch = Verification::Tier.batch(users)
      users.each { |user| assert_equal Verification::Tier.for(user), batch[user.id], "tier for #{user.name}" }
      assert_equal "verified_pro", batch[pro.id]
      assert_equal "verified", batch[plain.id]
      assert_nil batch[unverified.id]
    end
  end
end
