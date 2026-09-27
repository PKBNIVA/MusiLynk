# Trigram indexes for every text and jsonb::text column that SearchController matches
# with a leading-wildcard ILIKE, so public searches use bitmap index scans instead of
# sequential scans. jobs.title, jobs.company and acts.name were indexed in
# 20260919000000_add_production_indexes. Built concurrently so a deploy never blocks writes.
class AddSearchTrigramIndexes < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  COLUMNS = {
    jobs: %i[description],
    users: %i[name],
    profiles: %i[headline bio],
    acts: %i[tagline bio],
    portfolio_items: %i[title description]
  }.freeze
  JSONB_COLUMNS = {
    jobs: %i[skills],
    profiles: %i[skills roles],
    acts: %i[genres],
    portfolio_items: %i[tags genres roles]
  }.freeze

  def up
    COLUMNS.each do |table, columns|
      columns.each do |column|
        add_index table, column, using: :gin, opclass: :gin_trgm_ops, algorithm: :concurrently, if_not_exists: true
      end
    end
    JSONB_COLUMNS.each do |table, columns|
      columns.each do |column|
        add_index table, "(#{column}::text) gin_trgm_ops", using: :gin, name: "index_#{table}_on_#{column}_text_trgm",
                  algorithm: :concurrently, if_not_exists: true
      end
    end
  end

  def down
    JSONB_COLUMNS.each { |table, columns| columns.each { remove_index table, name: "index_#{table}_on_#{_1}_text_trgm", algorithm: :concurrently, if_exists: true } }
    COLUMNS.each { |table, columns| columns.each { remove_index table, _1, algorithm: :concurrently, if_exists: true } }
  end
end
