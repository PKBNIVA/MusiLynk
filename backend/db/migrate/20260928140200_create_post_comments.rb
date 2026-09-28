# Comments on a post, with one level of replies (parent_id). created_by_user_id is
# always the real person, same rationale as posts.author_id/created_by_user_id.
class CreatePostComments < ActiveRecord::Migration[8.1]
  def change
    create_table :post_comments, id: :string do |t|
      t.string :post_id, null: false
      t.string :author_type, null: false
      t.string :author_id, null: false
      t.string :created_by_user_id, null: false
      t.text :body, null: false
      t.string :parent_id
      t.string :status, null: false, default: "active"
      t.timestamps
    end

    add_index :post_comments, %i[post_id created_at]
    add_index :post_comments, :parent_id
    add_index :post_comments, :created_by_user_id
    add_foreign_key :post_comments, :posts, on_delete: :cascade
    add_foreign_key :post_comments, :users, column: :created_by_user_id
    add_foreign_key :post_comments, :post_comments, column: :parent_id, on_delete: :cascade
  end
end
