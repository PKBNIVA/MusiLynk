# Gives every person who already has a profile or work samples one default portfolio that mirrors
# what they have today: its rules match every item in their library, and it has no overrides, so
# headline, bio, city, genres and rates are inherited from the profile (the master copy).
# The title is the profile headline (or "My work"). It is public when the person is already
# listed publicly as talent, otherwise private.
# Links only: profiles and portfolio_items are never modified or deleted.
# Idempotent (people who already have any portfolio are skipped) and safe on a live database:
# batched with find_each, one short insert per person, no table locks.
# Rollback deletes only the portfolios this backfill created (backfilled = true).
class BackfillDefaultPortfolios < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  BATCH_SIZE = 500
  TITLE_LIMIT = 120
  RULES = { "everything" => true, "sort" => "featured" }.freeze

  # Frozen copies of the tables this migration reads and writes, so later model changes cannot
  # alter what it does.
  class BackfillUser < ActiveRecord::Base
    self.table_name = "users"
  end

  class BackfillPortfolio < ActiveRecord::Base
    self.table_name = "portfolios"
  end

  def up
    candidates.find_each(batch_size: BATCH_SIZE) { backfill(_1) }
  end

  def down
    BackfillPortfolio.where(backfilled: true).in_batches(of: BATCH_SIZE) { _1.delete_all }
  end

  private

  def candidates
    BackfillUser
      .where("EXISTS (SELECT 1 FROM profiles WHERE profiles.user_id = users.id) OR EXISTS (SELECT 1 FROM portfolio_items WHERE portfolio_items.user_id = users.id)")
      .where("NOT EXISTS (SELECT 1 FROM portfolios WHERE portfolios.owner_type = 'user' AND portfolios.owner_id = users.id)")
  end

  def backfill(user)
    headline = select_value("SELECT headline FROM profiles WHERE user_id = #{connection.quote(user.id)}")
    title = headline.to_s.strip.first(TITLE_LIMIT).presence || "My work"
    now = Time.current
    # The unique default-per-owner index makes this a no-op if the person made one meanwhile.
    BackfillPortfolio.insert_all([{
      id: "port_#{SecureRandom.uuid}", owner_type: "user", owner_id: user.id, title:, rules: RULES,
      visibility: listed_talent?(user) ? "public" : "private", slug: slug_for(title), is_default: true,
      status: "active", backfilled: true, created_at: now, updated_at: now
    }], unique_by: :index_portfolios_one_default_per_owner)
  end

  def listed_talent?(user)
    user.role == "jobseeker" && user.status == "active" && user.profile_complete
  end

  def slug_for(title)
    base = title.parameterize.first(60).delete_suffix("-").presence || "portfolio"
    "#{base}-#{SecureRandom.alphanumeric(6).downcase}"
  end
end
