require "test_helper"
require_relative "../support/showcase_helpers"

# Portfolios and resumes can be reported; moderators can hide a portfolio.
class ShowcaseModerationTest < ActionDispatch::IntegrationTest
  include ShowcaseHelpers

  setup do
    @admin = User.create!(name: "Mod Admin", email: "mod-#{SecureRandom.hex(3)}@example.com", password: PASSWORD, role: "admin", status: "active")
    @owner = make_user("Riya Keys", profile: { headline: "Keys" })
    @reporter = make_user("Careful Viewer", "employer")
    @portfolio = Portfolio.create!(owner_type: "user", owner_id: @owner.id, title: "Public EPK", visibility: "public")
    @resume = Resume.create!(user: @owner, title: "CV")
  end

  test "a public portfolio can be reported and hidden, which resolves every open report on it" do
    post "/api/reports", params: { entityType: "portfolio", entityId: @portfolio.id, reason: "Spam or scam" }, headers: auth(@reporter), as: :json
    assert_response :created
    first = Report.find(json["id"])
    second_reporter = make_user("Second Viewer")
    post "/api/reports", params: { entityType: "portfolio", entityId: @portfolio.id, reason: "Other" }, headers: auth(second_reporter), as: :json
    second = Report.find(json["id"])

    get "/api/admin/reports", params: { entityType: "portfolio" }, headers: auth(@admin)
    assert_equal "Public EPK", json["reports"].find { _1["id"] == first.id }["entityTitle"]
    get "/api/admin/reports/#{first.id}/context", headers: auth(@admin)
    assert_equal @owner.id, json.dig("reportedUser", "id")
    assert_equal 2, json.dig("history", "reportsTotal")

    post "/api/admin/reports/#{first.id}/moderate", params: { decision: "hide_portfolio", note: "Scam links" }, headers: auth(@admin), as: :json
    assert_response :success
    assert_equal [second.id, first.id].sort, json["resolvedReportIds"].sort
    assert_equal "hidden", @portfolio.reload.status
    assert AuditLog.exists?(action: "admin.report.hide_portfolio", entity_id: first.id)

    get "/api/public/portfolios/#{@portfolio.slug}"
    assert_response :not_found
    # The owner still sees it, marked hidden, and cannot un-hide it.
    get "/api/portfolios/#{@portfolio.id}", headers: auth(@owner)
    assert_equal "hidden", json.dig("portfolio", "status")
    patch "/api/portfolios/#{@portfolio.id}", params: { status: "active", title: "Renamed" }, headers: auth(@owner), as: :json
    assert_equal "hidden", @portfolio.reload.status
  end

  test "hide_portfolio only applies to portfolio reports" do
    report = Report.create!(reporter: @reporter, entity_type: "job", entity_id: published_job(@owner).id, reason: "Other", status: "open")
    post "/api/admin/reports/#{report.id}/moderate", params: { decision: "hide_portfolio" }, headers: auth(@admin), as: :json
    assert_equal "WRONG_ENTITY_TYPE", json["code"]
  end

  test "private portfolios and resumes are reportable only by an employer they were sent to" do
    @portfolio.update!(visibility: "private")
    %w[portfolio resume].each do |type|
      id = type == "portfolio" ? @portfolio.id : @resume.id
      post "/api/reports", params: { entityType: type, entityId: id, reason: "Other" }, headers: auth(@reporter), as: :json
      assert_response :not_found, type
    end

    Application.create!(job: published_job(@reporter), candidate: @owner, portfolio: @portfolio, resume: @resume)
    %w[portfolio resume].each do |type|
      id = type == "portfolio" ? @portfolio.id : @resume.id
      post "/api/reports", params: { entityType: type, entityId: id, reason: "Misleading opportunity" }, headers: auth(@reporter), as: :json
      assert_response :created, type
    end
    resume_report = Report.find_by!(entity_type: "resume")
    get "/api/admin/reports/#{resume_report.id}/context", headers: auth(@admin)
    assert_equal @owner.id, json.dig("reportedUser", "id")
    get "/api/admin/reports", headers: auth(@admin)
    assert_equal "CV", json["reports"].find { _1["id"] == resume_report.id }["entityTitle"]
  end

  test "a Page portfolio's report points at the Page owner" do
    band = make_act(@owner)
    page_portfolio = Portfolio.create!(owner_type: "act", owner_id: band.id, title: "Band EPK")
    post "/api/reports", params: { entityType: "portfolio", entityId: page_portfolio.id, reason: "Other" }, headers: auth(@reporter), as: :json
    get "/api/admin/reports/#{json['id']}/context", headers: auth(@admin)
    assert_equal @owner.id, json.dig("reportedUser", "id")
  end
end
