# "Applause" reactions on a post, one per actor (person or Page) per post.
class CreatePostReactions < ActiveRecord::Migration[8.1]
  def change
    create_table :post_reactions, id: :string do |t|
      t.string :post_id, null: false
      t.string :actor_type, null: false
      t.string :actor_id, null: false
      t.string :kind, null: false, default: "applause"
      t.timestamps
    end

    add_index :post_reactions, %i[post_id actor_type actor_id], unique: true, name: "index_post_reactions_on_post_and_actor"
    add_index :post_reactions, %i[actor_type actor_id]
    add_foreign_key :post_reactions, :posts
  end
end
