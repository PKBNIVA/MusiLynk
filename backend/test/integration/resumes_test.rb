require "test_helper"
require_relative "../support/showcase_helpers"

# The career record (one master) and resumes as views over it.
class ResumesTest < ActionDispatch::IntegrationTest
  include ShowcaseHelpers

  setup do
    @me = make_user("Riya Keys", profile: { headline: "Keys player", bio: "Profile bio" })
    @other = make_user("Other Person")
  end

  test "career entries: create, validate, edit once, delete" do
    post "/api/career-entries", params: { kind: "experience", fields: { role: "Keys", organization: "Night Shift", current: true }, startOn: "2019-06", tags: ["live"] },
      headers: auth(@me), as: :json
    assert_response :created
    entry = json["entry"]
    assert_equal ["experience", "2019-06-01", ["live"], 0], entry.values_at("kind", "startOn", "tags", "position")
    assert AuditLog.exists?(action: "career_entry.create", entity_id: entry["id"])

    [
      { kind: "hobby", fields: { name: "x" } },
      { kind: "skill", fields: {} },
      { kind: "skill", fields: { name: "x", colour: "red" } },
      { kind: "skill", fields: { name: "x", level: "god" } },
      { kind: "credit", fields: { title: "x", year: 1800 } },
      { kind: "credit", fields: { title: "x", url: "http://insecure.example" } },
      { kind: "experience", fields: { role: "x", current: "yes" } },
      { kind: "experience", fields: { role: "x" * 121 } },
      { kind: "skill", fields: "name" },
      { kind: "skill", fields: { name: "x" }, tags: [""] },
      { kind: "skill", fields: { name: "x" }, startOn: "June" },
      { kind: "skill", fields: { name: "x" }, startOn: "2024-13" },
      { kind: "experience", fields: { role: "x" }, startOn: "2024", endOn: "2020" }
    ].each do |params|
      post "/api/career-entries", params:, headers: auth(@me), as: :json
      assert_response :unprocessable_content, params.inspect
    end

    patch "/api/career-entries/#{entry['id']}", params: { fields: { role: "Musical director", organization: "Night Shift" }, endOn: "2024" }, headers: auth(@me), as: :json
    assert_response :success
    assert_equal ["Musical director", "2024-01-01"], [json.dig("entry", "fields", "role"), json.dig("entry", "endOn")]
    patch "/api/career-entries/#{entry['id']}", params: { kind: "skill" }, headers: auth(@me), as: :json
    assert_equal "KIND_FIXED", json["code"]

    get "/api/career-entries", params: { kind: "experience" }, headers: auth(@me)
    assert_equal [entry["id"]], json["entries"].pluck("id")
    assert_includes json["kinds"]["credit"], "title"

    patch "/api/career-entries/#{entry['id']}", params: { tags: ["x"] }, headers: auth(@other), as: :json
    assert_response :not_found
    delete "/api/career-entries/#{entry['id']}", headers: auth(@other)
    assert_response :not_found
    delete "/api/career-entries/#{entry['id']}", headers: auth(@me)
    assert_response :success
    assert_not CareerEntry.exists?(entry["id"])
  end

  test "a resume shows the record through its rules, pins and exclusions, grouped by section" do
    credit = CareerEntry.create!(user: @me, kind: "credit", fields: { "title" => "Album", "year" => 2022 }, tags: ["studio"])
    old_job = CareerEntry.create!(user: @me, kind: "experience", fields: { "role" => "Teacher" }, start_on: Date.new(2015, 1, 1))
    new_job = CareerEntry.create!(user: @me, kind: "experience", fields: { "role" => "Keys" }, start_on: Date.new(2021, 1, 1), tags: ["studio"])
    skill = CareerEntry.create!(user: @me, kind: "skill", fields: { "name" => "Sight reading" })

    post "/api/resumes", params: { title: "Studio CV", rules: { any: { tags: ["studio"] } }, pinnedEntryIds: [skill.id] }, headers: auth(@me), as: :json
    assert_response :created
    resume = json["resume"]
    assert_equal %w[experience credit skill], resume["sections"].pluck("kind")
    assert_equal [new_job.id], resume["sections"].first["entries"].pluck("id")
    assert resume["isDefault"]

    # Edit the master once: every resume reflects it.
    old_job.update!(tags: ["studio"])
    put "/api/resumes/#{resume['id']}/entries/#{credit.id}", params: { state: "excluded" }, headers: auth(@me), as: :json
    assert_response :success
    sections = json.dig("resume", "sections")
    assert_equal [new_job.id, old_job.id], sections.first["entries"].pluck("id"), "newest first"
    assert_equal %w[experience skill], sections.pluck("kind")

    patch "/api/resumes/#{resume['id']}", params: { rules: { everything: true, sort: "manual" }, entryOrder: [old_job.id, skill.id], sectionOrder: %w[skill experience] },
      headers: auth(@me), as: :json
    assert_response :success
    assert_equal %w[skill experience], json.dig("resume", "sections").pluck("kind")
    assert_equal [old_job.id, new_job.id], json.dig("resume", "sections").last["entries"].pluck("id")

    put "/api/resumes/#{resume['id']}/entries/#{credit.id}", params: { state: "auto" }, headers: auth(@me), as: :json
    assert_equal 4, json.dig("resume", "entryCount")
    put "/api/resumes/#{resume['id']}/entries/#{CareerEntry.create!(user: @other, kind: 'skill', fields: { 'name' => 'x' }).id}", params: { state: "pinned" }, headers: auth(@me), as: :json
    assert_response :not_found
    patch "/api/resumes/#{resume['id']}", params: { pinnedEntryIds: ["care_not-mine"] }, headers: auth(@me), as: :json
    assert_equal "INVALID_ENTRY", json["code"]
  end

  test "headline and summary inherit the profile until overridden; reset goes back" do
    post "/api/resumes", params: { title: "CV" }, headers: auth(@me), as: :json
    id = json["id"]
    assert_equal ["Keys player", "Profile bio", []], json["resume"].values_at("headline", "summary", "overridden")
    patch "/api/resumes/#{id}", params: { summary: "Tailored summary" }, headers: auth(@me), as: :json
    assert_equal ["Tailored summary", ["summary"]], json["resume"].values_at("summary", "overridden")
    @me.profile.update!(headline: "Pianist", bio: "New bio")
    get "/api/resumes/#{id}", headers: auth(@me)
    assert_equal ["Pianist", "Tailored summary"], json["resume"].values_at("headline", "summary")
    post "/api/resumes/#{id}/reset", params: { fields: ["summary"] }, headers: auth(@me), as: :json
    assert_equal "New bio", json.dig("resume", "summary")
    patch "/api/resumes/#{id}", params: { headline: "" }, headers: auth(@me), as: :json
    assert_empty json.dig("resume", "overridden")
  end

  test "a PDF must be the person's own completed PDF upload" do
    post "/api/resumes", params: { title: "CV", uploadId: make_pdf(@me).id }, headers: auth(@me), as: :json
    assert_response :created
    assert_equal "cv.pdf", json.dig("resume", "pdf", "filename")
    id = json["id"]
    [make_pdf(@other).id, make_pdf(@me, status: "pending").id, make_pdf(@me, content_type: "image/png").id, "none"].each do |upload_id|
      patch "/api/resumes/#{id}", params: { uploadId: upload_id }, headers: auth(@me), as: :json
      assert_response :unprocessable_content, upload_id
    end
    patch "/api/resumes/#{id}", params: { uploadId: nil }, headers: auth(@me), as: :json
    assert_nil json.dig("resume", "pdf")
  end

  test "resumes are personal: other people get 404, the acting-as header changes nothing" do
    theirs = Resume.create!(user: @other, title: "Theirs")
    get "/api/resumes/#{theirs.id}", headers: auth(@me)
    assert_response :not_found
    patch "/api/resumes/#{theirs.id}", params: { title: "Mine" }, headers: auth(@me), as: :json
    assert_response :not_found
    delete "/api/resumes/#{theirs.id}", headers: auth(@me)
    assert_response :not_found
    band = make_act(@me)
    post "/api/resumes", params: { title: "Mine" }, headers: auth(@me, as: "act:#{band.id}"), as: :json
    assert_equal @me.id, Resume.find(json["id"]).user_id
  end

  test "defaults, deletion hand-off, caps and rate limits" do
    first = Resume.create!(user: @me, title: "First", is_default: true)
    second = Resume.create!(user: @me, title: "Second")
    post "/api/resumes/#{second.id}/default", headers: auth(@me), as: :json
    assert_equal [false, true], [first.reload.is_default, second.reload.is_default]
    delete "/api/resumes/#{second.id}", headers: auth(@me)
    assert first.reload.is_default
    assert AuditLog.exists?(action: "resume.destroy", entity_id: second.id)

    (Resume::MAX_PER_USER - 1).times { Resume.create!(user: @me, title: "R#{_1}") }
    post "/api/resumes", params: { title: "Too many" }, headers: auth(@me), as: :json
    assert_equal "LIMIT_REACHED", json["code"]

    with_counting_cache do
      headers = auth(@other)
      ResumesController::CREATES_PER_HOUR.times { post "/api/resumes", params: { title: "" }, headers:, as: :json }
      post "/api/resumes", params: { title: "Late" }, headers:, as: :json
      assert_response :too_many_requests
      CareerEntriesController::CREATES_PER_HOUR.times { post "/api/career-entries", params: { kind: "hobby" }, headers:, as: :json }
      post "/api/career-entries", params: { kind: "skill", fields: { name: "x" } }, headers:, as: :json
      assert_response :too_many_requests
    end
  end

  test "career entry cap" do
    rows = Array.new(CareerEntry::MAX_PER_USER) { |i| { id: "care_#{SecureRandom.uuid}", user_id: @me.id, kind: "skill", fields: { "name" => "S#{i}" }, created_at: Time.current, updated_at: Time.current } }
    CareerEntry.insert_all!(rows)
    post "/api/career-entries", params: { kind: "skill", fields: { name: "One more" } }, headers: auth(@me), as: :json
    assert_equal "LIMIT_REACHED", json["code"]
  end

  test "new career entries that nearly fit a resume are suggested" do
    resume = Resume.create!(user: @me, title: "Film", rules: { "any" => { "tags" => ["film"] } })
    entry = CareerEntry.create!(user: @me, kind: "credit", fields: { "title" => "Score for a short film" })
    suggestion = ShowcaseSuggestion.find_by!(target_type: "resume", target_id: resume.id, subject_id: entry.id)
    assert_match(/mentions film/, suggestion.reason)
    post "/api/suggestions/#{suggestion.id}/accept", headers: auth(@me), as: :json
    assert_includes resume.reload.pinned_entry_ids, entry.id
    get "/api/resumes/#{resume.id}", headers: auth(@me)
    assert_equal [entry.id], json.dig("resume", "sections").first["entries"].pluck("id")

    tagged = CareerEntry.create!(user: @me, kind: "credit", fields: { "title" => "Another film" }, tags: ["film"])
    assert_not ShowcaseSuggestion.exists?(subject_id: tagged.id), "a rule match needs no suggestion"
    entry.destroy!
    assert_not ShowcaseSuggestion.exists?(subject_id: entry.id)
    resume.destroy!
    assert_not ShowcaseSuggestion.exists?(target_id: resume.id)
  end

  test "resume validation" do
    [{ title: "" }, { title: "x", rules: { any: { colour: ["x"] } } }, { title: "x", sectionOrder: ["hobby"] }, { title: "x", sectionOrder: "credit" },
     { title: "x", excludedEntryIds: [{ a: 1 }] }, { title: "x" * 121 }].each do |params|
      post "/api/resumes", params:, headers: auth(@me), as: :json
      assert_response :unprocessable_content, params.inspect
    end
    post "/api/resumes/#{Resume.create!(user: @me, title: 'x').id}/entries/x", params: {}, headers: auth(@me), as: :json
    assert_response :not_found
  end
end
