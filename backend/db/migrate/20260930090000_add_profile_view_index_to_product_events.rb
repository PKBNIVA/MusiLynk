# The profile_view ingest counts a profile's views with `props->>'profileId' = ?` on every event
# (EventsController#check_profile_view_milestones); without an index that scans every
# profile_view row. A partial expression index serves exactly that predicate.
class AddProfileViewIndexToProductEvents < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_index :product_events, "((props->>'profileId'))", where: "name = 'profile_view'",
      name: "index_product_events_on_profile_view_profile_id", algorithm: :concurrently, if_not_exists: true
  end
end
