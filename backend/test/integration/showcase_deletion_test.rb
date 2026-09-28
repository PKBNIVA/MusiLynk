require "test_helper"
require_relative "../support/showcase_helpers"

# Deleting a library item or a whole account is never blocked by portfolios, resumes or
# suggestions, and leaves nothing pointing at what is gone.
class ShowcaseDeletionTest < ActionDispatch::IntegrationTest
  include ShowcaseHelpers

  setup do
    @me = make_user("Riya Keys", profile: { headline: "Keys" })
    @item = make_item(@me, "Pinned take", description: "jazz trio")
    @kept = make_item(@me, "Kept take")
    @band = make_act(@me)
    @personal = Portfolio.create!(owner_type: "user", owner_id: @me.id, title: "Mine", pinned_item_ids: [@item.id, @kept.id], item_order: [@item.id],
      rules: { "any" => { "genres" => ["Jazz"] } })
    @page = Portfolio.create!(owner_type: "act", owner_id: @band.id, title: "Band", excluded_item_ids: [@item.id], rules: { "everything" => true })
    @entry = CareerEntry.create!(user: @me, kind: "credit", fields: { "title" => "A film score" })
    @resume = Resume.create!(user: @me, title: "CV", pinned_entry_ids: [@entry.id], rules: { "any" => { "tags" => ["film"] } })
  end

  test "deleting a pinned work sample succeeds and it drops out of every view" do
    assert ShowcaseSuggestion.exists?(subject_id: @item.id)
    delete "/api/portfolio/#{@item.id}", headers: auth(@me)
    assert_response :success
    assert_equal [[@kept.id], []], [@personal.reload.pinned_item_ids, @personal.item_order]
    assert_equal [], @page.reload.excluded_item_ids
    assert_equal [@kept.id], @personal.members.map { _1.first.id }
    assert_not ShowcaseSuggestion.exists?(subject_id: @item.id)
    get "/api/portfolios/#{@page.id}", headers: auth(@me, as: "act:#{@band.id}")
    assert_equal [@kept.id], json.dig("portfolio", "items").pluck("itemId")
  end

  test "deleting a pinned career entry succeeds and it leaves every resume" do
    delete "/api/career-entries/#{@entry.id}", headers: auth(@me)
    assert_response :success
    assert_equal [], @resume.reload.pinned_entry_ids
    assert_empty @resume.members
  end

  test "account erasure removes the personal showcase and keeps the Page's portfolios" do
    employer = make_user("Studio Owner", "employer")
    application = Application.create!(job: published_job(employer), candidate: @me, portfolio: @personal, resume: @resume,
      materials_snapshot: Application.materials_snapshot(@personal, @resume))
    page_suggestion = ShowcaseSuggestion.create!(owner_type: "act", owner_id: @band.id, target_type: "portfolio", target_id: @page.id,
      subject_type: "portfolio_item", subject_id: @kept.id, kind: "include")
    assert ShowcaseSuggestion.where(owner_type: "user", owner_id: @me.id).exists?

    delete "/api/account", params: { confirmEmail: @me.email }, headers: auth(@me), as: :json
    assert_response :success
    assert_not Portfolio.exists?(@personal.id)
    assert Portfolio.exists?(@page.id), "a Page's portfolio stays with the Page"
    assert_equal 0, Resume.where(user_id: @me.id).count
    assert_equal 0, CareerEntry.where(user_id: @me.id).count
    assert_equal 0, ShowcaseSuggestion.where(owner_type: "user", owner_id: @me.id).count
    assert_not ShowcaseSuggestion.exists?(page_suggestion.id), "suggestions about the erased items go too"
    assert_not Application.exists?(application.id)
    assert_equal "deleted", @me.reload.status
  end

  test "the data export includes portfolios, the career record and resumes" do
    get "/api/account/export", headers: auth(@me)
    assert_response :success
    assert_equal [@personal.id], json["portfolios"].pluck("id")
    assert_equal [@entry.id], json["careerEntries"].pluck("id")
    assert_equal [@resume.id], json["resumes"].pluck("id")
  end
end
