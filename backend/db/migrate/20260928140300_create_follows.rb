# A person follows another identity (a person, an organization or an act). Always
# followed by a real person (follower_user_id): a Page cannot itself follow anyone.
class CreateFollows < ActiveRecord::Migration[8.1]
  def change
    create_table :follows, id: :string do |t|
      t.string :follower_user_id, null: false
      t.string :followable_type, null: false
      t.string :followable_id, null: false
      t.timestamps
    end

    add_index :follows, %i[follower_user_id followable_type followable_id], unique: true, name: "index_follows_on_follower_and_followable"
    add_index :follows, %i[followable_type followable_id]
    add_foreign_key :follows, :users, column: :follower_user_id
  end
end
