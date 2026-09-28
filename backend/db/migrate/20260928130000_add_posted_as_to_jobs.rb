# A job can be posted as a Page the employer runs (an organization or an act). employer_id stays
# the person, so every existing ownership and permission check is unchanged; posted_as_* only
# says whose name the listing carries. Both columns are nullable: NULL means "posted personally".
class AddPostedAsToJobs < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_column :jobs, :posted_as_type, :string
    add_column :jobs, :posted_as_id, :string
    add_index :jobs, %i[posted_as_type posted_as_id], where: "posted_as_id IS NOT NULL", algorithm: :concurrently, if_not_exists: true
  end
end
