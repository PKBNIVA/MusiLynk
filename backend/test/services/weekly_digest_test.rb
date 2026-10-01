require "test_helper"

class WeeklyDigestTest < ActiveSupport::TestCase
  setup do
    @seq = 0
    @since = 7.days.ago
    @now = Time.current
  end

  test "musician digest lists matching open requests and matching new jobs, each capped and real" do
    musician = create_musician(city: "Mumbai", roles: ["Drummer"], genres: ["Rock"])
    employer = create_hirer
    matching_request = UrgentRequest.create!(requester: employer, title: "Drummer for a Friday show", role_name: "Drummer",
      city: "Mumbai", currency: "INR", status: "open", start_at: 1.day.from_now)
    UrgentRequest.create!(requester: employer, title: "Sitar player needed", role_name: "Sitar", city: "Delhi",
      currency: "INR", status: "open", start_at: 1.day.from_now)
    matching_job = Job.create!(employer:, title: "Rock band drummer", company: employer.name, location: "Mumbai", kind: "Contract",
      genre: "Rock", description: "A properly documented professional opportunity with clear responsibilities and terms.", status: "published")

    sections = WeeklyDigest.build(musician, since: @since, until_time: Time.current)
    requests_section = sections.find { _1[:heading] == "Urgent requests near you" }
    jobs_section = sections.find { _1[:heading] == "New opportunities matching your roles" }

    assert_equal 1, requests_section[:items].size
    assert_includes requests_section[:items].first[:text], matching_request.role_name
    assert_equal 1, jobs_section[:items].size
    assert_includes jobs_section[:items].first[:text], matching_job.title
  end

  test "musician digest's community footnote counts requests filled in the window" do
    musician = create_musician
    employer = create_hirer
    filled = UrgentRequest.create!(requester: employer, title: "Filled one", role_name: "Bass", city: "Pune",
      currency: "INR", status: "filled", start_at: 1.day.from_now)
    filled.update_column(:updated_at, 2.days.ago)
    UrgentRequest.create!(requester: employer, title: "Filled long ago", role_name: "Bass", city: "Pune",
      currency: "INR", status: "filled", start_at: 1.day.from_now).update_column(:updated_at, 30.days.ago)

    sections = WeeklyDigest.build(musician, since: @since, until_time: Time.current)
    community = sections.find { _1[:heading] == "Across Verse" }
    assert_equal "1 request was filled through Verse this week.", community[:footnote]
  end

  test "musician digest ignores demo urgent requests, in the list and in the filled count" do
    musician = create_musician(city: "Mumbai", roles: ["Drummer"])
    demo_hirer = create_hirer
    demo_hirer.update_column(:synthetic_batch, "demo-showcase")
    UrgentRequest.create!(requester: demo_hirer, title: "Demo drummer", role_name: "Drummer", city: "Mumbai",
      currency: "INR", status: "open", start_at: 1.day.from_now)
    UrgentRequest.create!(requester: demo_hirer, title: "Demo filled", role_name: "Bass", city: "Pune",
      currency: "INR", status: "filled", start_at: 1.day.from_now)

    sections = WeeklyDigest.build(musician, since: @since, until_time: Time.current)
    assert_empty sections.find { _1[:heading] == "Urgent requests near you" }[:items]
    assert_nil sections.find { _1[:heading] == "Across Verse" }[:footnote], "a zero is left out, not printed"
  end

  test "hirer digest includes newly verified musicians matching posted roles and city" do
    hirer = create_hirer(city: "Chennai")
    Job.create!(employer: hirer, title: "Need a vocalist", company: hirer.name, location: "Chennai", kind: "Contract",
      genre: "Carnatic", skills: ["Vocalist"],
      description: "A properly documented professional opportunity with clear responsibilities and terms.", status: "published")
    verified = create_musician(city: "Chennai", roles: ["Vocalist"])
    verified.profile.update!(verified: true)
    verified.verification_requests.create!(kind: "professional", status: "approved", reviewed_at: 2.days.ago)

    sections = WeeklyDigest.build(hirer, since: @since, until_time: Time.current)
    verified_section = sections.find { _1[:heading].start_with?("Newly verified musicians") }
    assert_equal 1, verified_section[:items].size
    assert_includes verified_section[:items].first[:text], verified.name
  end

  test "hirer digest's fastest responders ranks by median response time in the hirer's city" do
    hirer = create_hirer(city: "Goa")
    fast = create_musician
    request = UrgentRequest.create!(requester: hirer, title: "Need a keys player", role_name: "Keys", city: "Goa",
      currency: "INR", status: "open", start_at: 1.day.from_now)
    UrgentRequestResponse.create!(urgent_request: request, user: fast, status: "available",
      created_at: request.created_at + 5.minutes)

    sections = WeeklyDigest.build(hirer, since: @since, until_time: Time.current)
    fastest = sections.find { _1[:heading] == "Fastest responders this week" }
    assert_includes fastest[:items].first[:text], fast.name.split.first
  end

  private

  def create_musician(city: nil, roles: [], genres: [])
    @seq += 1
    user = User.create!(name: "WD Musician #{@seq}", email: "wd-musician-#{@seq}-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "jobseeker", status: "active")
    user.create_profile!(location: city, roles:, genres:)
    user
  end

  def create_hirer(city: nil)
    @seq += 1
    user = User.create!(name: "WD Hirer #{@seq}", email: "wd-hirer-#{@seq}-#{SecureRandom.hex(4)}@example.com",
      password: "StrongPass123!", role: "employer", status: "active")
    user.create_profile!(location: city)
    user
  end
end
