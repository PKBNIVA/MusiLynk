require "test_helper"

class SearchFiltersTest < ActionDispatch::IntegrationTest
  test "job search covers marketplace fields and verified employer filtering" do
    verified_employer = create_user("Verified Studio", "verified-search@example.com", "employer")
    verified_employer.create_profile!(company_name: "Verified Studio", verified: true)
    unverified_employer = create_user("Unverified Studio", "unverified-search@example.com", "employer")
    unverified_employer.create_profile!(company_name: "Unverified Studio", verified: false)

    matching_job = Job.create!(
      employer: verified_employer,
      title: "Tour production opening",
      company: "Verified Studio",
      location: "Mumbai",
      kind: "Contract",
      genre: "Neo-soul",
      function_area: "Music Direction",
      opportunity_kind: "tour",
      skills: ["Pedal Steel", "Sight-reading"],
      requirements: "The instrumentalist must support a rotating concert lineup.",
      description: "Join a professionally managed production with written terms, rehearsals and an experienced touring team.",
      status: "published"
    )
    applicant = create_user("Counted Applicant", "counted-applicant@example.com", "jobseeker")
    matching_job.applications.create!(candidate: applicant)
    Job.create!(
      employer: unverified_employer,
      title: "Other public opening",
      company: "Unverified Studio",
      location: "Delhi",
      kind: "Contract",
      genre: "Pop",
      description: "A separately managed production with written terms, rehearsals and an experienced touring team.",
      status: "published"
    )

    ["neo-soul", "music direction", "pedal steel", "instrumentalist", "tour"].each do |term|
      get "/api/jobs", params: { q: term }
      assert_response :success
      assert_includes response.parsed_body.fetch("jobs").pluck("id"), matching_job.id, "expected jobs q=#{term.inspect} to search its structured fields"
    end

    get "/api/jobs", params: { verified: "true" }
    assert_response :success
    jobs = response.parsed_body.fetch("jobs")
    assert_equal [matching_job.id], jobs.pluck("id")
    assert_equal 1, jobs.first.fetch("applicationsCount")
  end

  test "talent search covers professional capabilities and credits" do
    professional = create_user("Searchable Professional", "talent-search@example.com", "jobseeker")
    professional.create_profile!(
      headline: "Session specialist",
      bio: "Available for recording and live work.",
      skills: ["Vocal arranging"],
      credits: ["Moonlight Sessions"],
      gear: ["Nord Stage 4"],
      software: ["Ableton Live"],
      roles: ["Playback Singer"],
      instruments: ["Sarangi"],
      genres: ["Qawwali"]
    )

    ["vocal arranging", "moonlight sessions", "nord stage", "ableton", "playback singer", "sarangi", "qawwali"].each do |term|
      get "/api/public/talent", params: { q: term }
      assert_response :success
      assert_includes response.parsed_body.fetch("talent").pluck("id"), professional.id, "expected talent q=#{term.inspect} to search professional capabilities"
    end
  end

  test "act search covers booking taxonomy and lineup capabilities" do
    owner = create_user("Act Owner", "act-search@example.com", "jobseeker")
    owner.create_profile!
    act = Act.create!(
      owner:,
      name: "The Search Ensemble",
      act_type: "corporate band",
      genres: ["Sufi fusion"],
      event_types: ["Destination wedding"],
      currency: "INR",
      fee_basis: "event",
      status: "active"
    )
    act.act_members.create!(display_name: "Lead Member", role_name: "Choir Director", instrument: "Santoor", member_status: "confirmed")

    ["corporate band", "sufi fusion", "destination wedding", "choir director", "santoor"].each do |term|
      get "/api/public/acts", params: { q: term }
      assert_response :success
      assert_includes response.parsed_body.fetch("acts").pluck("id"), act.id, "expected acts q=#{term.inspect} to search booking and lineup fields"
    end
  end

  private

  def create_user(name, email, role)
    User.create!(name:, email:, password: "StrongPass123!", role:, status: "active", profile_complete: true)
  end

  test "jobs accept several roles at once and match any of them" do
    employer = create_user("Roles Studio", "roles-studio@example.com", "employer")
    employer.create_profile!(company_name: "Roles Studio")
    make = lambda do |title, **extra|
      Job.create!(employer:, title:, company: "Roles Studio", location: "Mumbai", kind: "Contract", genre: "Pop",
        description: "A well described production with written terms, rehearsals and an experienced team.", status: "published", **extra)
    end
    drummer = make.call("Drummer for a wedding band")
    vocalist = make.call("Lead vocalist needed")
    engineer = make.call("Sound engineer for a festival")
    pianist = make.call("Pianist for a lounge")

    get "/api/jobs", params: { roles: "Drummer,Vocalist" }
    assert_response :success
    assert_equal [drummer.id, vocalist.id].sort, response.parsed_body.fetch("jobs").pluck("id").sort
    assert_equal 2, response.parsed_body.fetch("total")

    get "/api/jobs", params: { roles: "Sound engineer, Pianist" }
    assert_equal [engineer.id, pianist.id].sort, response.parsed_body.fetch("jobs").pluck("id").sort, "a two-word role matches as a phrase"

    get "/api/jobs", params: { roles: "Drummer" }
    assert_equal [drummer.id], response.parsed_body.fetch("jobs").pluck("id")

    get "/api/jobs", params: { roles: "Drummer,Vocalist", q: "wedding" }
    assert_equal [drummer.id], response.parsed_body.fetch("jobs").pluck("id"), "roles narrow a typed search"

    get "/api/jobs", params: { roles: "Drummer,Vocalist", location: "Delhi" }
    assert_empty response.parsed_body.fetch("jobs"), "other filters still apply"

    get "/api/jobs", params: { roles: " , ," }
    assert_equal 4, response.parsed_body.fetch("total"), "blank roles filter nothing"

    get "/api/jobs", params: { roles: "%$;" }
    assert_empty response.parsed_body.fetch("jobs"), "roles that are nothing searchable match nothing"
  end

  test "roles must be a single text value and at most six are used" do
    get "/api/jobs", params: { roles: %w[Drummer Vocalist] }
    assert_response :bad_request
    assert_equal "INVALID_FILTER", response.parsed_body["code"]

    employer = create_user("Many Roles", "many-roles@example.com", "employer")
    employer.create_profile!(company_name: "Many Roles")
    late = Job.create!(employer:, title: "Tubaist wanted", company: "Many Roles", location: "Pune", kind: "Contract", genre: "Pop",
      description: "A well described production with written terms, rehearsals and an experienced team.", status: "published")
    get "/api/jobs", params: { roles: "drummer,vocalist,pianist,violinist,flautist,sitarist,tubaist" }
    assert_response :success
    assert_not_includes response.parsed_body.fetch("jobs").pluck("id"), late.id
  end
end
