# The Stage: community feed posts. A post is authored by a person or a Page they
# run (author_type/author_id, resolved through ActorResolver); created_by_user_id is
# always the real person, kept for audit and moderation even when posted as a Page.
class CreatePosts < ActiveRecord::Migration[8.1]
  def change
    create_table :posts, id: :string do |t|
      t.string :author_type, null: false
      t.string :author_id, null: false
      t.string :created_by_user_id, null: false
      t.string :kind, null: false, default: "update"
      t.text :body
      t.jsonb :media, null: false, default: []
      t.string :link_url
      t.string :shared_portfolio_item_id
      t.string :shared_job_id
      t.string :reshared_post_id
      t.string :city
      t.string :genres, array: true, null: false, default: []
      t.string :hashtags, array: true, null: false, default: []
      t.string :visibility, null: false, default: "public"
      t.string :status, null: false, default: "active"
      t.integer :applause_count, null: false, default: 0
      t.integer :comment_count, null: false, default: 0
      t.integer :reshare_count, null: false, default: 0
      t.timestamps
    end

    add_index :posts, %i[author_type author_id created_at]
    add_index :posts, [:created_at, :id]
    add_index :posts, :status
    add_index :posts, :created_by_user_id
    add_index :posts, :shared_portfolio_item_id
    add_index :posts, :shared_job_id
    add_index :posts, :reshared_post_id
    add_index :posts, :hashtags, using: :gin
    add_index :posts, :genres, using: :gin
    add_foreign_key :posts, :users, column: :created_by_user_id
    # Nullified rather than restricted: deleting the shared portfolio item, job or original
    # post must never block on a post that merely links to it. The feed/serializers render an
    # "unavailable" shared preview once the reference goes null (see Post#shared_entity_preview).
    add_foreign_key :posts, :portfolio_items, column: :shared_portfolio_item_id, on_delete: :nullify
    add_foreign_key :posts, :jobs, column: :shared_job_id, on_delete: :nullify
    add_foreign_key :posts, :posts, column: :reshared_post_id, on_delete: :nullify
  end
end
