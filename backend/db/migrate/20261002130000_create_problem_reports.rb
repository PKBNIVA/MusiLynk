# In-app "Report a problem": what a person (signed in, or a signed-out visitor who left an
# email) tells us went wrong, the page they were on, the context they agreed to attach and
# an optional screenshot (an Active Storage blob; the table keeps string ids so the blob is
# linked by column instead of has_one_attached).
class CreateProblemReports < ActiveRecord::Migration[8.1]
  def change
    create_table :problem_reports, id: :string do |t|
      t.string :user_id
      t.string :email
      t.text :description, null: false
      t.text :expected
      t.string :page
      t.jsonb :context, null: false, default: {}
      t.string :status, null: false, default: "new"
      t.text :admin_note
      t.bigint :screenshot_blob_id
      t.string :handled_by_id
      t.datetime :handled_at
      t.timestamps
    end
    add_index :problem_reports, :user_id
    add_index :problem_reports, [:status, :created_at]
    add_index :problem_reports, :screenshot_blob_id
    add_foreign_key :problem_reports, :users, column: :user_id, on_delete: :cascade
    add_foreign_key :problem_reports, :users, column: :handled_by_id, on_delete: :nullify
  end
end
