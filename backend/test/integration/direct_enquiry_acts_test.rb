require "test_helper"
require Rails.root.join("db/migrate/20261001120000_hide_direct_enquiry_acts").to_s

# The solo act behind quotes asked of a musician directly is "hidden": it keeps the bookings,
# but is not in the musician's My acts, cannot be activated into a listing, and is in no public
# listing, search, sitemap or share page.
class DirectEnquiryActsTest < ActionDispatch::IntegrationTest
  setup do
    @hirer = create_user("Hira Hirer", "de-hirer@example.com", "employer")
    @musician = create_user("Dev Drummer", "de-drummer@example.com", "jobseeker")
    @musician.create_profile!(headline: "Drummer", location: "Mumbai", roles: ["Drummer"], verified: true)
    post "/api/bookings", params: { musicianId: @musician.id, eventType: "wedding", city: "Mumbai", eventDate: 2.months.from_now.to_date.iso8601 }, headers: auth(@hirer), as: :json
    assert_response :created
    @booking = BookingRequest.find(response.parsed_body.fetch("id"))
    @act = @booking.act
  end

  test "a direct quote creates a hidden solo act, reused for the next one" do
    assert_equal %w[solo hidden], [@act.act_type, @act.status]
    assert_equal Act::DIRECT_ENQUIRY_TAGLINE, @act.tagline
    assert_equal [@act], Act.direct_enquiry.to_a
    post "/api/bookings", params: { musicianId: @musician.id, eventType: "corporate", city: "Mumbai", eventDate: 3.months.from_now.to_date.iso8601 }, headers: auth(@hirer), as: :json
    assert_equal 1, @musician.owned_acts.count
    get "/api/bookings", headers: auth(@musician)
    assert_equal 2, response.parsed_body.fetch("bookings").size, "the musician still sees these bookings"
  end

  test "it is not in My acts, public listings, search, sitemap or the acting identities" do
    own = Act.create!(owner: @musician, name: "Dev Quartet", act_type: "band", currency: "INR", fee_basis: "event", status: "active")
    get "/api/acts/me", headers: auth(@musician)
    assert_equal [own.id], response.parsed_body.fetch("acts").pluck("id")

    get "/api/public/acts"
    assert_equal [own.id], response.parsed_body.fetch("acts").pluck("id")
    get "/api/public/acts/#{@act.id}"
    assert_response :not_found
    get "/api/acts", headers: auth(@hirer)
    assert_not_includes response.parsed_body.fetch("acts").pluck("id"), @act.id
    get "/api/search", params: { q: "Dev Drummer" }
    assert_not_includes response.parsed_body.fetch("results").pluck("id"), @act.id
    get "/sitemap.xml"
    assert_not_includes response.body, @act.id
    post "/api/bookings", params: { actId: @act.id, eventType: "wedding", city: "Mumbai", eventDate: 2.months.from_now.to_date.iso8601 }, headers: auth(@hirer), as: :json
    assert_response :not_found
    assert_not_includes ActorResolver.identities_for(@musician).map(&:id), @act.id
  end

  test "a moderated act is still listed for its owner, with its hidden status" do
    moderated = Act.create!(owner: @musician, name: "Moderated Band", act_type: "band", currency: "INR", fee_basis: "event", status: "hidden")
    get "/api/acts/me", headers: auth(@musician)
    assert_equal [moderated.id], response.parsed_body.fetch("acts").pluck("id")
    assert_equal "hidden", response.parsed_body.fetch("acts").first.fetch("status")
  end

  test "the owner cannot activate it, set hidden, or bring a moderated act back" do
    put "/api/acts/#{@act.id}", params: { name: "Dev Drummer", actType: "solo", status: "active" }, headers: auth(@musician), as: :json
    assert_equal "hidden", @act.reload.status
    delete "/api/acts/#{@act.id}", headers: auth(@musician)
    assert_equal "hidden", @act.reload.status

    mine = Act.create!(owner: @musician, name: "Mine", act_type: "band", currency: "INR", fee_basis: "event", status: "active")
    put "/api/acts/#{mine.id}", params: { name: "Mine", actType: "band", status: "hidden" }, headers: auth(@musician), as: :json
    assert_equal "active", mine.reload.status, "hidden is not the owner's to set"
    post "/api/acts", params: { name: "Sneaky", actType: "trio", status: "hidden" }, headers: auth(@musician), as: :json
    assert_equal "active", Act.find(response.parsed_body.fetch("id")).status

    moderated = Act.create!(owner: @musician, name: "Moderated Band", act_type: "band", currency: "INR", fee_basis: "event", status: "hidden")
    put "/api/acts/#{moderated.id}", params: { name: "Moderated Band", actType: "band" }, headers: auth(@musician), as: :json
    assert_equal "hidden", moderated.reload.status, "an update never re-lists a moderated act"
    # An ordinary act still toggles.
    put "/api/acts/#{mine.id}", params: { name: "Mine", actType: "band", status: "inactive" }, headers: auth(@musician), as: :json
    assert_equal "inactive", mine.reload.status
  end

  test "the data migration moves old inactive direct-enquiry acts to hidden and leaves other acts alone, both ways" do
    old = Act.create!(owner: @musician, name: "Dev Drummer", act_type: "solo", currency: "INR", fee_basis: "event", status: "inactive", tagline: Act::DIRECT_ENQUIRY_TAGLINE)
    paused = Act.create!(owner: @musician, name: "Paused Band", act_type: "band", currency: "INR", fee_basis: "event", status: "inactive")
    same_tag_active = Act.create!(owner: @musician, name: "Live", act_type: "solo", currency: "INR", fee_basis: "event", status: "active", tagline: Act::DIRECT_ENQUIRY_TAGLINE)
    migration = HideDirectEnquiryActs.new
    migration.verbose = false
    2.times { migration.up }
    assert_equal "hidden", old.reload.status
    assert_equal "inactive", paused.reload.status
    assert_equal "active", same_tag_active.reload.status
    assert_equal "hidden", @act.reload.status
    migration.down
    assert_equal "inactive", old.reload.status
    assert_equal "inactive", @act.reload.status
    assert_equal "inactive", paused.reload.status
  end

  test "an enquiry after the deploy but before the migration reuses the old inactive act" do
    @act.update_columns(status: "inactive")
    assert_no_difference "Act.count" do
      post "/api/bookings", params: { musicianId: @musician.id, eventType: "sangeet", city: "Mumbai", eventDate: 4.months.from_now.to_date.iso8601 }, headers: auth(@hirer), as: :json
    end
    assert_response :created
    assert_equal @act.id, BookingRequest.find(response.parsed_body.fetch("id")).act_id
  end

  private

  def create_user(name, email, role)
    User.create!(name:, email:, password: "StrongPass123!", role:, status: "active", email_verified: true, profile_complete: true)
  end

  def auth(user)
    raw = SecureRandom.urlsafe_base64(48)
    user.sessions.create!(token_digest: Digest::SHA256.hexdigest(raw), expires_at: 30.days.from_now)
    { "Authorization" => "Bearer #{raw}" }
  end
end
