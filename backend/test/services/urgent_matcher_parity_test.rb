require "test_helper"
require "minitest/mock"
require_relative "../support/query_budget"
require_relative "../support/urgent_matcher_legacy"

# The SQL ranking (UrgentMatcher::Query) must give exactly the scores and reasons the Ruby ranking
# it replaced (UrgentMatcher::Legacy, test-only) gave, for the same people and the same request.
# One seeded sample covers the cases the rules turn on: synonym groups, whole-word roles, headline
# matches, instruments, city text, verification, recent sign-ins and every availability window.
class UrgentMatcherParityTest < ActiveSupport::TestCase
  include QueryBudget

  ROLES = ["Drummer", "Vocalist", "Gayak", "Playback Singer", "Tabla Vadak", "Dholak Player", "Dhol Player", "Lead Guitarist",
    "Bass Guitarist", "Electric Guitarist", "Keys Player", "Flautist", "Percussionist", "DJ", "Violinist"].freeze
  INSTRUMENTS = ["Drum Kit", "Tabla", "Dhol", "Guitar", "Keyboard", "Bansuri", "Electric Guitar", "Harmonium"].freeze
  HEADLINES = ["Wedding drummer", "Dholak player for sangeet", "Playback singer", "Session guitarist", "Tabla Vadak", "Bansuri Player",
    "Drum-Kit (own)", "Weekend DJ", nil].freeze
  LOCATIONS = ["Mumbai", "Navi Mumbai, Maharashtra", "Bandra, Mumbai", "Delhi", "Pune", "Mumbaikar 100%", nil].freeze

  REQUESTS = {
    "role, city, with an end time" => { role_name: "Drummer", city: "Mumbai" },
    "role, city, no end time (default duration)" => { role_name: "Vocalist", city: "Mumbai", end_at: nil },
    "role and instrument in Delhi" => { role_name: "Tabla Player", instrument: "Tabla", city: "Delhi" },
    "whole-word role" => { role_name: "Dhol Player", city: "Mumbai" },
    "role with a synonym spelling" => { role_name: "Gayak", city: "Pune" },
    "role and a different instrument" => { role_name: "Percussionist", instrument: "Drum Kit", city: "Mumbai" },
    "instrument only" => { role_name: "", instrument: "Guitar", city: "Mumbai" },
    "punctuated names" => { role_name: "Drum-Kit (own)", instrument: "Electric Guitar!", city: "Mumbai" },
    "a city with LIKE wildcards" => { role_name: "DJ", city: "100%" },
    "no city (everywhere)" => { role_name: "Electric Guitarist" },
    "neither role nor instrument (everyone in the city)" => { role_name: "", city: "Mumbai" },
    "a role nobody has" => { role_name: "Theremin Virtuoso", city: "Mumbai" }
  }.freeze

  setup do
    @hirer = make_user("Hirer", "employer")
    @start = 6.hours.from_now
    seed_musicians
  end

  REQUESTS.each do |name, attrs|
    test "SQL ranking matches the Ruby ranking: #{name}" do
      request = build_request(attrs)
      expected = everyone { UrgentMatcher::Legacy.call(request) }
      actual = everyone { UrgentMatcher.call(request) }

      assert_equal summary(expected), summary(actual)
      assert_equal expected.size, actual.size
      assert_equal actual.map(&:score), actual.map(&:score).sort.reverse, "best first"
      assert_equal actual.map { _1.user.id }.uniq, actual.map { _1.user.id }
    end
  end

  test "the sample is rich enough to make the parity check mean something" do
    request = build_request(REQUESTS["role, city, with an end time"])
    ranked = everyone { UrgentMatcher.call(request) }
    assert_operator ranked.size, :>=, 5
    assert_operator ranked.map(&:score).uniq.size, :>=, 4, "several different scores"
    assert ranked.any? { _1.reasons.include?("Verified") }
    assert ranked.any? { _1.reasons.any? { |r| r.start_with?("Available on") } || _1.score >= 45 }
    assert_not_empty everyone { UrgentMatcher.call(build_request(REQUESTS["neither role nor instrument (everyone in the city)"])) }
    assert_empty everyone { UrgentMatcher.call(build_request(REQUESTS["a role nobody has"])) }
  end

  test "the top rows under the candidate limit carry the best scores and the order breaks ties by recent sign-in" do
    request = build_request(REQUESTS["role, city, with an end time"])
    all = everyone { UrgentMatcher::Legacy.call(request) }
    limited = UrgentConfig.stub(:candidate_limit, 4) { UrgentMatcher.call(request) }

    assert_equal 4, limited.size
    assert_equal all.map(&:score).first(4), limited.map(&:score)
    limited.each_cons(2) do |a, b|
      next unless a.score == b.score
      assert_operator last_seen(a.user), :>=, last_seen(b.user), "equal scores: most recent sign-in first" if last_seen(a.user) && last_seen(b.user)
    end
  end

  test "the admin's one-person notify scores a person exactly as the ranked pass does" do
    request = build_request(REQUESTS["role, city, with an end time"])
    ranked = everyone { UrgentMatcher.call(request) }
    pick = ranked.find { _1.reasons.include?("Verified") } || ranked.first

    UrgentMatcher.notify!(request.tap(&:save!), only_user_ids: [pick.user.id])
    assert_equal pick.reasons, UrgentRequestNotification.find_by!(urgent_request: request, user: pick.user, channel: "in_app").reasons
  end

  test "ranking costs three queries however many musicians match" do
    request = build_request(REQUESTS["role, city, with an end time"])
    assert_queries_at_most(3, "UrgentMatcher.call") { UrgentMatcher.call(request) }
    assert_queries_at_most(3, "UrgentMatcher.call, city-less") { UrgentMatcher.call(build_request(role_name: "Drummer")) }
  end

  test "the weights come from config/urgent.yml" do
    request = build_request(REQUESTS["role, city, with an end time"])
    before = UrgentMatcher.call(request).to_h { [_1.user.id, _1.score] }
    heavier = UrgentConfig.weights.merge(verified: UrgentConfig.weight(:verified) + 100)

    after = UrgentConfig.stub(:weights, heavier) { UrgentMatcher.call(request).to_h { [_1.user.id, _1.score] } }
    verified_ids = Profile.where(verified: true).pluck(:user_id)
    after.each do |id, score|
      assert_equal before.fetch(id, 0) + (verified_ids.include?(id) ? 100 : 0), score if before.key?(id)
    end
    assert_operator after.values.max, :>, before.values.max
  end

  private

  def everyone(&block) = UrgentConfig.stub(:candidate_limit, 1_000, &block)

  # id => [score, reasons]: what the hirer and the admin see for each person.
  def summary(candidates) = candidates.to_h { [_1.user.id, [_1.score, _1.reasons]] }

  def last_seen(user) = user.sessions.maximum(:last_seen_at)

  def build_request(attrs)
    UrgentRequest.new({ requester: @hirer, title: "Urgent", role_name: "Drummer", city: nil, instrument: nil, start_at: @start,
      end_at: @start + 3.hours, currency: "INR", status: "open" }.merge(attrs))
  end

  # One password hash for all of them: hashing 95 passwords per test would dominate the run time.
  def make_user(name, role, status: "active", profile_complete: true)
    @@digest ||= User.new(password: "StrongPass123!").password_digest
    User.create!(name:, email: "parity-#{SecureRandom.hex(5)}@example.com", password_digest: @@digest, role:, status:,
      email_verified: true, profile_complete:)
  end

  # Deterministic: the same 90 people on every run. Profiles, sessions and windows are bulk-inserted
  # (no callbacks, one statement each): creating them one by one costs ~60 ms a profile.
  def seed_musicians
    rng = Random.new(20_261_009)
    pick = ->(list) { list[rng.rand(list.size)] }
    profiles = []
    sessions = []
    windows = []
    90.times do |i|
      user = make_user("Musician #{i}", "jobseeker")
      profiles << { user_id: user.id, headline: pick.(HEADLINES), location: pick.(LOCATIONS), verified: rng.rand < 0.3,
                    roles: Array.new(rng.rand(0..2)) { pick.(ROLES) }.uniq, instruments: Array.new(rng.rand(0..2)) { pick.(INSTRUMENTS) }.uniq }
      case rng.rand(4)
      when 0 then sessions << session_row(user, rng.rand(1..20).days.ago)
      when 1 then sessions << session_row(user, rng.rand(40..200).days.ago)
      end
      windows << window_row(user, rng)
    end
    # People the matcher must leave out whatever they list, and one with no profile at all.
    [make_user("Suspended", "jobseeker", status: "suspended"), make_user("Incomplete", "jobseeker", profile_complete: false),
     make_user("Another hirer", "employer"), @hirer].each do |user|
      profiles << { user_id: user.id, headline: "Also a drummer", location: "Mumbai", roles: ["Drummer"], instruments: [], verified: true }
    end
    make_user("No profile", "jobseeker")

    Profile.insert_all!(profiles)
    Session.insert_all!(sessions)
    AvailabilityWindow.insert_all!(windows.compact)
  end

  def session_row(user, last_seen_at)
    { id: SecureRandom.uuid, user_id: user.id, token_digest: SecureRandom.hex(20), last_seen_at:, expires_at: 1.day.from_now }
  end

  # Every kind of window, placed around the request: blocking and overlapping, blocking and clear of
  # it, available and covering it, available but too short, and none.
  def window_row(user, rng)
    s = @start
    kind, from, to = case rng.rand(8)
    when 0 then [:unavailable, s - 1.hour, s + 1.hour]
    when 1 then [:booked, s + 2.hours, s + 8.hours]
    when 2 then [:hold, s - 5.hours, s + 30.minutes]
    when 3 then [:unavailable, s + 4.hours, s + 9.hours]
    when 4 then [:available, s - 1.hour, s + 4.hours]
    when 5 then [:available, s, s + 1.hour]
    when 6 then [:unavailable, s - 9.hours, s - 1.minute]
    end
    { id: SecureRandom.uuid, user_id: user.id, status: kind.to_s, start_at: from, end_at: to } if kind
  end
end
