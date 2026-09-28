# Many portfolios per owner (a person, an organization or an act). A portfolio is a view over the
# owner's one library of work samples (portfolio_items), not a copy:
# - membership is computed on read: items matching `rules`, plus `pinned_item_ids`, minus
#   `excluded_item_ids` (see ShowcaseRules), ordered by the rule's sort or `item_order`;
# - headline, bio, city, genres and rates are overrides: NULL inherits the owner's master copy
#   (the profile, or the act/organization), so editing the master updates every portfolio.
class CreatePortfolios < ActiveRecord::Migration[8.1]
  def change
    create_table :portfolios, id: :string do |t|
      t.string :owner_type, null: false
      t.string :owner_id, null: false
      t.string :title, null: false
      t.string :purpose
      t.string :headline
      t.text :bio
      t.string :city
      t.jsonb :genres
      t.jsonb :rates
      t.jsonb :rules, null: false, default: {}
      t.jsonb :pinned_item_ids, null: false, default: []
      t.jsonb :excluded_item_ids, null: false, default: []
      t.jsonb :item_order, null: false, default: []
      t.string :visibility, null: false, default: "public"
      t.string :slug, null: false
      t.boolean :is_default, null: false, default: false
      # "hidden" is set only by moderators (Admin::ReportsController#moderate).
      t.string :status, null: false, default: "active"
      # Rows created by the default-portfolio backfill, so its rollback removes only those.
      t.boolean :backfilled, null: false, default: false
      t.timestamps
    end
    add_index :portfolios, %i[owner_type owner_id]
    add_index :portfolios, :slug, unique: true
    add_index :portfolios, %i[owner_type owner_id], unique: true, where: "is_default", name: "index_portfolios_one_default_per_owner"
  end
end
