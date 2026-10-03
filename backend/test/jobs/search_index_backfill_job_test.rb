require "test_helper"

# Search documents (Search::Document): kept current by the models, filled in batches by the job.
class SearchIndexBackfillJobTest < ActiveJob::TestCase
  setup do
    @user = User.create!(name: "Indexed Person", email: "indexed-person@example.com", password: "StrongPass123!", role: "jobseeker", status: "active", profile_complete: true)
    @user.create_profile!(headline: "Tabla player", location: "Pune", roles: ["Tabla Player"])
  end

  def document(table, key, id) = ActiveRecord::Base.lease_connection.select_one("SELECT search_vector::text AS vector, search_text AS text FROM #{table} WHERE #{key} = #{ActiveRecord::Base.lease_connection.quote(id)}")

  test "saving a profile, renaming its user and changing a lineup keep the documents current" do
    assert_includes document("profiles", "user_id", @user.id)["text"], "tabla player"
    assert_match(/'tabla':\d+A/, document("profiles", "user_id", @user.id)["vector"], "the headline is weight A")
    assert_match(/'pune':\d+(?!\w)/, document("profiles", "user_id", @user.id)["vector"])

    @user.update!(name: "Renamed Rhythm")
    assert_includes document("profiles", "user_id", @user.id)["text"], "renamed rhythm"

    act = Act.create!(owner: @user, name: "Night Owls", act_type: "band", city: "Goa", currency: "INR", fee_basis: "event", status: "active")
    member = act.act_members.create!(display_name: "Keys", role_name: "Keys", instrument: "Harmonium", member_status: "confirmed")
    assert_includes document("acts", "id", act.id)["text"], "harmonium"
    member.destroy!
    assert_not_includes document("acts", "id", act.id)["text"], "harmonium"

    item = PortfolioItem.create!(user: @user, kind: "audio", title: "Teentaal solo", visibility: "public", url: "https://example.com/a.mp3")
    item.update!(tags: ["kirtan"])
    assert_includes document("portfolio_items", "id", item.id)["text"], "kirtan"
  end

  test "the document columns are never loaded or serialised" do
    profile = Profile.find(@user.id)
    assert_not profile.has_attribute?(:search_vector)
    assert_not_includes profile.api_json.keys, "searchText"
    assert_not_includes Profile.column_names, "search_text"
  end

  test "a full run rebuilds every document in batches; the nightly sweep fills only missing ones" do
    Profile.where(user_id: @user.id).update_all(headline: "Dhol player", search_vector: nil, search_text: nil)
    employer = User.create!(name: "Batch Hirer", email: "batch-hirer@example.com", password: "StrongPass123!", role: "employer", status: "active")
    3.times do |index|
      Job.create!(employer:, title: "Batch job #{index}", company: "Batch", location: "Delhi", kind: "Contract", genre: "Folk", status: "published",
        description: "A paid engagement with written terms and a clear schedule for every session.")
    end
    Job.update_all(title: "Shehnai needed")

    counts = SearchIndexBackfillJob.perform_now(missing_only: true)
    assert_equal({ "jobs" => 0, "talent" => 1, "acts" => 0, "samples" => 0 }, counts, "only the row without a document")
    assert_includes document("profiles", "user_id", @user.id)["text"], "dhol player"
    assert_not_includes document("jobs", "id", Job.first.id)["text"], "shehnai", "stale but present documents wait for a full run"

    assert_equal 3, Search::Indexer.backfill("jobs", batch_size: 2)
    texts = Job.pluck(:id).map { document("jobs", "id", _1)["text"] }
    assert texts.all? { _1.include?("shehnai") }, texts.inspect
    assert_equal({ "jobs" => 3, "talent" => 1, "acts" => 0, "samples" => 0 }, SearchIndexBackfillJob.perform_now)
  end

  test "a run that built documents drops the cached sitemap" do
    original = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    Rails.cache.write(SitemapsController::CACHE_KEY, "<urlset/>")
    SearchIndexBackfillJob.perform_now(missing_only: true)
    assert Rails.cache.exist?(SitemapsController::CACHE_KEY), "nothing was missing, so the sitemap stands"
    SearchIndexBackfillJob.perform_now
    assert_not Rails.cache.exist?(SitemapsController::CACHE_KEY)
  ensure
    Rails.cache = original
  end

  test "runs nightly for missing documents, and the admin reindex queues a full run" do
    entry = Rails.application.config.good_job.cron.fetch(:search_index_sweep)
    assert_equal "SearchIndexBackfillJob", entry[:class]
    assert_equal({ missing_only: true }, entry[:kwargs])
    assert_equal :scheduled, SearchIndexBackfillJob.new.queue_name.to_sym
    assert_equal 0, Search::Indexer.refresh("jobs", [])
  end
end
