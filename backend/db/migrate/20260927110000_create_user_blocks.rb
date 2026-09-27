# A user can block another user from messaging them. Blocking is one-directional
# in storage but stops messages both ways (see UserBlock.between?).
class CreateUserBlocks < ActiveRecord::Migration[8.1]
  def change
    create_table :user_blocks, id: :string do |t|
      t.references :blocker, type: :string, null: false, foreign_key: { to_table: :users, on_delete: :cascade }, index: false
      t.references :blocked, type: :string, null: false, foreign_key: { to_table: :users, on_delete: :cascade }
      t.timestamps
    end
    add_index :user_blocks, %i[blocker_id blocked_id], unique: true
  end
end
