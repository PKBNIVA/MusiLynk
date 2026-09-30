require "test_helper"
require_relative "../support/showcase_helpers"

# Directory ranking (verified, playable sample, completeness, rates, recent sign-in), the India-first
# facets on the talent lists and /api/search, the acts "member" filter, and hidden synthetic profiles
# staying out of compare and shortlist.
class TalentRankingAndFiltersTest < ActionDispatch::IntegrationTest
  include ShowcaseHelpers

  FULL = { headline: "Session drummer", bio: "Twelve years of studio and stage work.", location: "Mumbai", skills: ["Grooves"], genres: ["Bollywood"] }.freeze

  test "the directory ranks verified, then sample, then completeness, then rates, then recent sign-in" do
    empty = make_user("Empty Newest", profile: {})
    login_old = make_user("Login Old", profile: FULL.merge(session_rate: 5000))
    login_new = make_user("Login New", profile: FULL.merge(session_rate: 5000))
    rates_only = make_user("Rates Only", profile: FULL.merge(day_rate: 9000))
    complete = make_user("Complete No Rate", profile: FULL)
    partial = make_user("Partial", profile: { headline: "Drummer", session_rate: 4000 })
    sampled = make_user("Sampled Partial", profile: { headline: "Tabla" })
    make_item(sampled)
    verified = make_user("Verified Bare", profile: { verified: true })
    private_sample = make_user("Private Sample", profile: { headline: "Sitar" })
    make_item(private_sample, visibility: "private")
    login_old.update_columns(last_login_at: 10.days.ago)
    login_new.update_columns(last_login_at: 1.hour.ago)
    [rates_only, complete, partial, private_sample, empty, verified, sampled].each { _1.update_columns(last_login_at: nil) }

    get "/api/public/talent", params: { limit: 50 }
    assert_response :success
    mine = [empty, login_old, login_new, rates_only, complete, partial, sampled, verified, private_sample].map(&:name)
    names = response.parsed_body.fetch("talent").pluck("name") & mine
    assert_equal ["Verified Bare", "Sampled Partial"], names.first(2)
    assert_equal ["Login New", "Login Old", "Rates Only", "Complete No Rate"], names.values_at(2, 3, 4, 5)
    assert_operator names.index("Empty Newest"), :>, names.index("Partial"), "an empty profile never outranks a populated one"
    assert_operator names.index("Empty Newest"), :>, names.index("Complete No Rate")
  end

  test "language, event type, genre and budget filters narrow /public/talent and /candidates" do
    hindi = make_user("Hindi Ghazal", profile: FULL.merge(languages: ["Hindi", "Urdu"], genres: ["Ghazal"], event_types: ["Wedding"], session_rate: 8000, day_rate: 20_000))
    marathi = make_user("Marathi Folk", profile: FULL.merge(languages: ["Marathi"], genres: ["Folk"], open_to: ["Corporate events"], show_rate: 30_000))
    unpriced = make_user("No Rates", profile: FULL.merge(languages: ["Hindi"], genres: ["Ghazal"]))
    employer = make_user("Filter Hirer", "employer")

    mine = [hindi.id, marathi.id, unpriced.id]
    get "/api/public/talent", params: { language: "hindi" }
    assert_equal [hindi.id, unpriced.id].sort, ids(mine)
    get "/api/public/talent", params: { genre: "ghazal", budgetMax: "10000" }
    assert_equal [hindi.id], ids(mine), "budgetMax uses the lowest rate and leaves out people with no published rate"
    get "/api/public/talent", params: { eventType: "wedding" }
    assert_equal [hindi.id], ids(mine)
    get "/api/public/talent", params: { eventType: "corporate" }
    assert_equal [marathi.id], ids(mine), "open_to counts as an event type"
    get "/api/public/talent", params: { budgetMax: "abc" }
    assert_equal mine.sort, ids(mine), "a malformed budget is ignored"
    get "/api/public/talent", params: { language: ["Hindi"] }
    assert_response :bad_request

    get "/api/candidates", params: { language: "marathi", budgetMax: "40000" }, headers: auth(employer)
    assert_equal [marathi.id], response.parsed_body.fetch("candidates").pluck("id")
  end

  test "search applies the talent facets and keys its cache by them" do
    hindi = make_user("Facet Drummer", profile: FULL.merge(headline: "Facet drummer", languages: ["Hindi"], session_rate: 5000))
    make_user("Facet Guitarist", profile: FULL.merge(headline: "Facet guitarist", languages: ["Tamil"], session_rate: 5000))

    get "/api/search", params: { q: "facet", type: "talent", language: "hindi" }
    assert_response :success
    assert_equal [hindi.id], response.parsed_body.fetch("results").pluck("id")
    get "/api/search", params: { q: "facet", type: "talent" }
    assert_equal 2, response.parsed_body.fetch("results").length
    get "/api/search", params: { q: "facet", type: "talent", budgetMax: ["1"] }
    assert_response :bad_request
  end

  test "listings and profiles carry the completed booking count" do
    musician = make_user("Booked Musician", profile: FULL)
    hirer = make_user("Booking Hirer", "employer")
    act = make_act(musician, "Booked Act")
    2.times { BookingRequest.create!(act:, requester: hirer, event_type: "wedding", city: "Goa", currency: "INR", status: "completed") }
    BookingRequest.create!(act:, requester: hirer, event_type: "wedding", city: "Goa", currency: "INR", status: "requested")
    idle = make_user("Idle Musician", profile: FULL)

    counts = [musician, idle].to_h do |person|
      get "/api/public/talent", params: { q: person.name }
      [person.id, response.parsed_body.fetch("talent").find { _1["id"] == person.id }&.fetch("bookingsCount")]
    end
    assert_equal({ musician.id => 2, idle.id => 0 }, counts)
    get "/api/public/talent/#{musician.id}"
    assert_equal 2, response.parsed_body.dig("professional", "bookingsCount")
    get "/api/candidates/#{idle.id}", headers: auth(hirer)
    assert_equal 0, response.parsed_body.dig("candidate", "bookingsCount")
  end

  test "acts can be listed by the musician who owns or plays in them" do
    owner = make_user("Act Owner")
    player = make_user("Act Player")
    other = make_user("Other Owner")
    band = make_act(owner, "Owner Band")
    band.act_members.create!(display_name: "Act Player", role_name: "Drums", user: player, member_status: "confirmed")
    invited = make_act(other, "Other Band")
    invited.act_members.create!(display_name: "Act Player", role_name: "Drums", user: player, member_status: "invited")
    make_act(other, "Unrelated Band")

    get "/api/public/acts", params: { member: owner.id }
    assert_equal ["Owner Band"], response.parsed_body.fetch("acts").pluck("name")
    get "/api/public/acts", params: { member: player.id }
    assert_equal ["Owner Band"], response.parsed_body.fetch("acts").pluck("name")
    get "/api/public/acts", params: { city: "nowhere", member: owner.id }
    assert_empty response.parsed_body.fetch("acts")
  end

  test "compare and shortlist cannot reach a hidden synthetic profile" do
    employer = make_user("Compare Hirer", "employer")
    visible = make_user("Visible Talent", profile: FULL)
    peer = make_user("Peer Talent", profile: FULL)
    hidden = make_user("Hidden Talent", profile: FULL)
    hidden.update_columns(synthetic_batch: "local-qa")
    demo = make_user("Demo Talent", profile: FULL)
    demo.update_columns(synthetic_batch: "demo-20260926-1200")

    get "/api/candidates/compare/list", params: { ids: [visible.id, peer.id, hidden.id, demo.id].join(",") }, headers: auth(employer)
    assert_response :success
    assert_equal [visible.id, peer.id, demo.id].sort, response.parsed_body.fetch("professionals").pluck("id").sort

    post "/api/shortlists/#{hidden.id}", params: {}, headers: auth(employer), as: :json
    assert_response :not_found
    assert_not TalentShortlist.exists?(employer:, candidate: hidden)
    post "/api/shortlists/#{demo.id}", params: {}, headers: auth(employer), as: :json
    assert_response :created
  end

  private

  def ids(within) = response.parsed_body.fetch("talent").pluck("id").sort & within.sort
end
