require "test_helper"
require_relative "../support/showcase_helpers"

# Applying with a chosen portfolio and resume: only the applicant's own, and the employer sees a
# snapshot taken at apply time that later edits never change.
class ApplicationMaterialsTest < ActionDispatch::IntegrationTest
  include ShowcaseHelpers

  setup do
    @employer = make_user("Studio Owner", "employer")
    @job = published_job(@employer)
    @seeker = make_user("Riya Keys", profile: { headline: "Keys player", bio: "Bio" })
    @item = make_item(@seeker, "Blue in green", genres: ["Jazz"])
    @portfolio = Portfolio.create!(owner_type: "user", owner_id: @seeker.id, title: "Jazz", rules: { "any" => { "genres" => ["Jazz"] } }, headline: "Jazz keys")
    @credit = CareerEntry.create!(user: @seeker, kind: "credit", fields: { "title" => "Album" })
    @pdf = make_pdf(@seeker)
    @resume = Resume.create!(user: @seeker, title: "Session CV", upload: @pdf)
  end

  test "the employer sees the snapshot taken at apply time" do
    post "/api/jobs/#{@job.id}/apply", params: { coverLetter: "Keen", portfolioId: @portfolio.id, resumeId: @resume.id }, headers: auth(@seeker), as: :json
    assert_response :created
    application = Application.find(json["id"])
    assert_equal [@portfolio.id, @resume.id], [application.portfolio_id, application.resume_id]
    assert_equal({ "portfolioId" => @portfolio.id, "resumeId" => @resume.id }, AuditLog.find_by(action: "application.create", entity_id: application.id).metadata)

    # Later edits to the portfolio, the library, the record and the resume change nothing sent.
    @portfolio.update!(headline: "Changed")
    @item.update!(title: "Renamed")
    make_item(@seeker, "New jazz", genres: ["Jazz"])
    @credit.update!(fields: { "title" => "Edited album" })
    @resume.update!(title: "Renamed CV")

    get "/api/employer/applications", headers: auth(@employer)
    materials = json["applications"].first["materials"]
    assert_equal ["Jazz", "Jazz keys"], materials["portfolio"].values_at("title", "headline")
    assert_equal [["Blue in green"]], [materials["portfolio"]["items"].map { _1.dig("item", "title") }]
    assert_equal "Session CV", materials["resume"]["title"]
    assert_equal "Album", materials.dig("resume", "sections", 0, "entries", 0, "fields", "title")
    assert_equal @pdf.public_url, materials.dig("resume", "pdf", "url")
    assert_equal "Keys player", materials.dig("resume", "headline")

    # The applicant sees what they sent too, and the PDF stays referenced after the resume goes.
    get "/api/applications", headers: auth(@seeker)
    assert_equal "Jazz", json["applications"].first.dig("materials", "portfolio", "title")
    @resume.destroy!
    assert_nil application.reload.resume_id
    assert @pdf.referenced?
    assert_includes Upload.where.not(id: Upload.unreferenced.select(:id)).pluck(:id), @pdf.id
  end

  test "someone else's portfolio or resume, and a hidden portfolio, are refused with 422" do
    other = make_user("Other Person")
    theirs = Portfolio.create!(owner_type: "user", owner_id: other.id, title: "Theirs")
    their_resume = Resume.create!(user: other, title: "Theirs")
    hidden = Portfolio.create!(owner_type: "user", owner_id: @seeker.id, title: "Hidden", status: "hidden")
    [{ portfolioId: theirs.id }, { resumeId: their_resume.id }, { portfolioId: hidden.id }, { portfolioId: "nope" }].each do |params|
      post "/api/jobs/#{@job.id}/apply", params:, headers: auth(@seeker), as: :json
      assert_response :unprocessable_content, params.inspect
    end
    post "/api/jobs/#{@job.id}/apply", params: { portfolioId: ["x"] }, headers: auth(@seeker), as: :json
    assert_response :bad_request
    assert_equal 0, Application.count
  end

  test "a portfolio of a Page the applicant runs can be sent; without materials nothing is stored" do
    band = make_act(@seeker, "The Night Shift")
    band_portfolio = Portfolio.create!(owner_type: "act", owner_id: band.id, title: "Band", rules: { "everything" => true })
    post "/api/jobs/#{@job.id}/apply", params: { portfolioId: band_portfolio.id }, headers: auth(@seeker), as: :json
    assert_response :created
    assert_equal "The Night Shift", Application.find(json["id"]).materials_snapshot.dig("portfolio", "ownerName")

    other_job = published_job(@employer, title: "Another")
    post "/api/jobs/#{other_job.id}/apply", params: { coverLetter: "Hi" }, headers: auth(@seeker), as: :json
    assert_nil Application.find(json["id"]).materials_snapshot
  end
end
