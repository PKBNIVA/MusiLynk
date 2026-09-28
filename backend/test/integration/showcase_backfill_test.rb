require "test_helper"
require_relative "../support/showcase_helpers"
require Rails.root.join("db/migrate/20260928130500_backfill_default_portfolios").to_s
require Rails.root.join("db/migrate/20260928130600_backfill_career_entries").to_s

# The one-time backfills: data-safe (links and copies only), idempotent and reversible.
class ShowcaseBackfillTest < ActiveSupport::TestCase
  include ShowcaseHelpers

  setup do
    @listed = make_user("Listed Artist", profile: { headline: "Session drummer", genres: ["Rock"], skills: ["Mixing"], credits: ["Album session (2021)", "Live at NH7"],
      gear: ["Pearl kit"], languages: ["Hindi"], software: ["Pro Tools"], instruments: ["Drum Kit"], experience: "5 years" })
    @items = [make_item(@listed, "One", featured: true), make_item(@listed, "Two")]
    @unlisted = make_user("Quiet Person", complete: false, profile: { headline: "" })
    @items_only = make_user("Items Only")
    make_item(@items_only, "Solo")
    @bare = make_user("No Profile")
    @already = make_user("Already Set", profile: { headline: "Has one" })
    @existing = Portfolio.create!(owner_type: "user", owner_id: @already.id, title: "Mine")
    CareerEntry.create!(user: @already, kind: "skill", fields: { "name" => "Own" })
    @profile_before = @listed.profile.reload.attributes
    @items_before = PortfolioItem.order(:id).map(&:attributes)
  end

  test "default portfolios mirror today's profile and library and roll back cleanly" do
    migration = BackfillDefaultPortfolios.new
    migration.verbose = false
    2.times { migration.up }

    backfilled = Portfolio.where(backfilled: true).index_by(&:owner_id)
    assert_equal [@listed.id, @unlisted.id, @items_only.id].sort, backfilled.keys.sort, "one each, never for people who already have one"
    listed = backfilled[@listed.id]
    assert_equal ["Session drummer", "public", true, { "everything" => true, "sort" => "featured" }], [listed.title, listed.visibility, listed.is_default, listed.rules]
    assert_empty listed.overridden, "everything is inherited from the profile"
    assert_equal ["Session drummer", ["Rock"]], listed.effective.values_at("headline", "genres")
    assert_equal @items.map(&:id), listed.members.map { _1.first.id }
    assert_equal ["My work", "private"], [backfilled[@unlisted.id].title, backfilled[@unlisted.id].visibility]
    assert_equal "My work", backfilled[@items_only.id].title

    assert_equal @profile_before, @listed.profile.reload.attributes
    assert_equal @items_before, PortfolioItem.order(:id).map(&:attributes)

    migration.down
    assert_not Portfolio.exists?(backfilled: true)
    assert Portfolio.exists?(@existing.id), "rollback removes only backfilled rows"
  end

  test "career entries are copied from the profile lists that map cleanly and roll back cleanly" do
    migration = BackfillCareerEntries.new
    migration.verbose = false
    2.times { migration.up }

    entries = CareerEntry.where(user: @listed).order(:position)
    assert entries.all?(&:backfilled)
    assert_equal [["skill", { "name" => "Mixing" }, []], ["skill", { "name" => "Pro Tools" }, ["software"]], ["skill", { "name" => "Drum Kit" }, ["instrument"]],
      ["credit", { "title" => "Album session", "year" => 2021 }, []], ["credit", { "title" => "Live at NH7" }, []],
      ["gear", { "name" => "Pearl kit" }, []], ["language", { "name" => "Hindi" }, []]], entries.map { [_1.kind, _1.fields, _1.tags] }
    assert entries.all?(&:valid?), "backfilled rows satisfy the model's own validation"
    assert_equal 1, CareerEntry.where(user: @already).count, "people with a record are skipped"
    assert_equal 0, CareerEntry.where(user: @unlisted).count
    assert_equal @profile_before, @listed.profile.reload.attributes

    migration.down
    assert_equal 0, CareerEntry.where(backfilled: true).count
    assert_equal 1, CareerEntry.count
  end
end
