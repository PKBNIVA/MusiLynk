require "test_helper"
require "minitest/mock"

# The one visibility rule for demo (and other synthetic) accounts: they appear wherever a person
# browses (directory, search, hire and rates pages, popular searches, counts shown to visitors) and
# never in SEO or in metrics, e-mail, badges, system posts, review prompts or the funnel.
class DemoVisibilityRulesTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  DEMO = "demo-20260930-1200".freeze

  setup do
    @seq = 0
    @original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    clear_enqueued_jobs
  end

  teardown { Rails.cache = @original_cache }

  # --- what visitors see ---------------------------------------------------------------------

  test "hire pages count demo profiles for visitors but only organic ones make a page indexable" do
    4.times { |i| musician("Demo Drummer #{i}", batch: DEMO, roles: ["Drummer"], location: "Mumbai") }
    2.times { |i| musician("Organic Drummer #{i}", roles: ["Drummer"], location: "Mumbai") }
    musician("Hidden QA Drummer", batch: "qa-hidden", roles: ["Drummer"], location: "Mumbai")

    get "/api/public/hire-pages/drummer/mumbai"
    body = response.parsed_body
    assert_equal 6, body.dig("counts", "professionals"), "demo profiles count for visitors, hidden QA batches never do"
    assert_equal false, body.fetch("indexable")
    assert_equal 6, body.fetch("featured").size
    assert_equal 4, body.fetch("featured").count { _1["demo"] }

    assert_equal 2, Seo::HireStats.counts_for("Drummer", "Mumbai").fetch(:professionals), "the default (sitemap, indexability) is organic only"
    assert_equal 6, Seo::HireStats.counts_for("Drummer", "Mumbai", include_demo: true).fetch(:professionals)

    3.times { |i| musician("More Organic #{i}", roles: ["Drummer"], location: "Mumbai") }
    Rails.cache.clear
    get "/api/public/hire-pages/drummer/mumbai"
    assert_equal true, response.parsed_body.fetch("indexable")
  end

  test "popular searches include demo profiles" do
    5.times { |i| musician("Demo Singer #{i}", batch: DEMO, roles: ["Singer"], location: "Mumbai") }
    get "/api/public/hire-pages/popular-searches"
    assert(response.parsed_body.fetch("items").any? { _1.dig("role", "slug") == "singer" && _1.dig("city", "slug") == "mumbai" && _1["count"] == 5 })
  end

  test "rates pages use demo profiles for the numbers and organic ones for indexability" do
    5.times { |i| musician("Demo Keys #{i}", batch: DEMO, roles: ["Keyboard player"], location: "Mumbai", session_rate: 4000 + i * 1000) }
    get "/api/public/rates/mumbai"
    keys = response.parsed_body.fetch("roles").find { _1["slug"] == "keyboard-player" }
    assert keys.fetch("hasData")
    assert_equal 6000, keys.dig("sessionRate", "median")
    assert_equal false, response.parsed_body.fetch("indexable")

    assert_equal false, Seo::Rates.for_city("Mumbai").fetch("keyboard-player").hasData, "organic only by default"
    assert Seo::Rates.for_city("Mumbai", include_demo: true).fetch("keyboard-player").hasData
  end

  test "public stats keep an organic top level and add a listed variant" do
    organic = musician("Organic Verified", roles: ["Drummer"], location: "Mumbai", verified: true)
    musician("Demo Verified", batch: DEMO, roles: ["Drummer"], location: "Pune", verified: true)
    musician("QA Verified", batch: "qa-hidden", roles: ["Drummer"], location: "Delhi", verified: true)
    Job.create!(employer: organic, company: "Org", kind: "Gig", genre: "Folk", title: "Organic gig", description: "D" * 90, location: "Mumbai", status: "published")
    demo_hirer = User.create!(name: "Demo Hirer", email: "demo-hirer-stats@example.com", password: "StrongPass123!", role: "employer", status: "active", synthetic_batch: DEMO)
    Job.create!(employer: demo_hirer, company: "Demo Co", kind: "Gig", genre: "Folk", title: "Demo gig", description: "D" * 90, location: "Pune", status: "published")

    get "/api/public/stats"
    stats = response.parsed_body
    assert_equal [1, 1, 1, 1], stats.values_at("verifiedProfiles", "professionals", "cities", "openOpportunities")
    assert_equal({ "verifiedProfiles" => 2, "professionals" => 2, "cities" => 2, "openOpportunities" => 2, "urgentRequests" => 0 }, stats.fetch("listed"))
  end

  # --- what never includes them --------------------------------------------------------------

  test "the weekly digest is never sent to synthetic accounts" do
    real = musician("Real Digest", roles: ["Singer"], location: "Mumbai")
    demo = musician("Demo Digest", batch: DEMO, roles: ["Singer"], location: "Mumbai")
    sections = [{ heading: "Urgent requests near you", items: [{ text: "Drummer wanted" }] }]

    NotificationEmail.stub(:deliverable_to?, true) do
      WeeklyDigest.stub(:build, sections) { WeeklyDigestJob.perform_now }
    end

    assert LifecycleEmail.sent?(real, LifecycleEmail.digest_key)
    assert_not LifecycleEmail.sent?(demo, LifecycleEmail.digest_key)
    assert_enqueued_jobs 1, only: WeeklyDigestDeliveryJob
  end

  test "lifecycle sequences skip synthetic accounts and do not count their urgent requests" do
    real = musician("Real Day One", roles: ["Singer"], location: "Mumbai", created_at: 1.day.ago)
    demo = musician("Demo Day One", batch: DEMO, roles: ["Singer"], location: "Mumbai", created_at: 1.day.ago)
    LifecycleSequences.run
    assert LifecycleEmail.sent?(real, "musician_day1_first_link")
    assert_not LifecycleEmail.sent?(demo, "musician_day1_first_link")

    quiet = musician("Quiet Musician", roles: ["Singer"], location: "Mumbai", created_at: 40.days.ago)
    demo_hirer = User.create!(name: "Demo Hirer", email: "demo-lifecycle-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active", synthetic_batch: DEMO)
    UrgentRequest.create!(requester: demo_hirer, title: "Demo singer", role_name: "Singer", city: "Mumbai", currency: "INR", start_at: 1.day.from_now, status: "open")
    LifecycleSequences.run
    assert_not LifecycleEmail.sent?(quiet, "musician_day21_inactive_requests"), "a demo request is not a real reason to write to a real person"
  end

  test "system posts, badges and review prompts ignore synthetic accounts" do
    run_at = Time.current.change(usec: 0).beginning_of_hour
    demo = musician("Demo Welcome", batch: DEMO, roles: ["Singer"], location: "Mumbai", verified: true)
    real = musician("Real Welcome", roles: ["Singer"], location: "Mumbai", verified: true)
    [demo, real].each { _1.update_column(:updated_at, run_at - 10.minutes) }
    [demo, real].each { _1.profile.update_column(:updated_at, run_at - 10.minutes) }
    requester = User.create!(name: "Demo Requester", email: "demo-requester@example.com", password: "StrongPass123!", role: "employer", status: "active", synthetic_batch: DEMO)
    filled = UrgentRequest.create!(requester:, title: "Filled demo", role_name: "Singer", city: "Mumbai", currency: "INR", start_at: 1.day.from_now, status: "open")
    filled.update_columns(status: "filled", filled_by_id: demo.id, updated_at: run_at - 5.minutes)

    StageSystemPostsJob.perform_now(run_at + 1.minute)
    assert Post.exists?(system_ref: "welcome:#{real.id}")
    assert Post.exists?(system_ref: "verified:#{real.id}")
    assert_not Post.exists?(system_ref: "welcome:#{demo.id}")
    assert_not Post.exists?(system_ref: "verified:#{demo.id}")
    assert_not Post.exists?(system_ref: "urgent_filled:#{filled.id}")

    ReviewPromptSweepJob.perform_now
    assert_equal 0, ReviewPrompt.count
  end

  test "fast-responder badges and the leaderboard ignore synthetic responders and requesters" do
    week_start = Time.current.beginning_of_week(:monday) - 1.week
    real_hirer = User.create!(name: "Real City Hirer", email: "real-city-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active")
    demo_hirer = User.create!(name: "Demo City Hirer", email: "demo-city-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active", synthetic_batch: DEMO)
    real = musician("Real Fast", roles: ["Singer"], location: "Mumbai")
    demo = musician("Demo Fast", batch: DEMO, roles: ["Singer"], location: "Mumbai")
    2.times do
      [real_hirer, demo_hirer].each do |hirer|
        request = UrgentRequest.create!(requester: hirer, title: "Need someone", role_name: "Singer", city: "Mumbai", currency: "INR", start_at: 1.day.from_now, status: "open")
        request.update_column(:created_at, week_start + 1.day)
        [real, demo].each { request.urgent_request_responses.create!(user: _1, created_at: week_start + 1.day + 5.minutes) }
      end
    end

    FastResponderWeekJob.perform_now(week_start + 1.week + 1.hour)

    assert Badge.exists?(user_id: real.id)
    assert_not Badge.exists?(user_id: demo.id)
    post = Post.find_by!(system_kind: "fastest_responders")
    assert_includes post.body, "Real Fast"
    assert_not_includes post.body, "Demo Fast"
  end

  test "funnel queries leave out events and activity from synthetic accounts" do
    real = musician("Real Funnel", roles: ["Singer"], location: "Mumbai")
    demo = musician("Demo Funnel", batch: DEMO, roles: ["Singer"], location: "Mumbai")
    ProductEvent.insert_all([
      { id: "prod_real", anon_id: "a-real", user_id: real.id, name: "landing_view", props: {}, created_at: 1.day.ago },
      { id: "prod_anon", anon_id: "a-anon", user_id: nil, name: "landing_view", props: {}, created_at: 1.day.ago },
      { id: "prod_demo", anon_id: "a-demo", user_id: demo.id, name: "landing_view", props: {}, created_at: 1.day.ago }
    ])
    steps = FunnelQueries.summary(days: 7).fetch(:funnel).to_h { [_1.fetch(:step), _1.fetch(:count)] }
    assert_equal 2, steps.fetch("landing_view")

    hirer = User.create!(name: "Funnel Hirer", email: "funnel-hirer-rules@example.com", password: "StrongPass123!", role: "employer", status: "active")
    demo_hirer = User.create!(name: "Demo Funnel Hirer", email: "demo-funnel-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active", synthetic_batch: DEMO)
    act = Act.create!(owner: real, name: "Real Act", act_type: "solo", currency: "INR", fee_basis: "event", status: "active")
    [hirer, demo_hirer].each { BookingRequest.create!(act:, requester: _1, event_type: "wedding", city: "Mumbai", currency: "INR", status: "requested") }
    Rails.cache.clear
    weekly = FunnelQueries.summary(days: 7).fetch(:weekly)
    assert_equal 1, weekly.sum { _1.fetch(:bookings) }
  end

  private

  def musician(name, roles:, location:, batch: nil, verified: false, session_rate: nil, created_at: Time.current)
    @seq += 1
    user = User.create!(name:, email: "vis-#{@seq}-#{SecureRandom.hex(3)}@example.com", password: "StrongPass123!", role: "jobseeker", status: "active",
      profile_complete: true, email_verified: true, synthetic_batch: batch, created_at:)
    user.create_profile!(roles:, location:, headline: roles.first, verified:, session_rate:)
    user
  end
end
