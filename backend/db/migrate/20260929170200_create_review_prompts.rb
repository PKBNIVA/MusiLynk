# A nudge to write a review after an urgent request is filled or a booking completes. One row
# per (source, user) — both parties get their own prompt (ReviewPromptSweepJob). Never more than
# one reminder is sent (reminded_at set once).
class CreateReviewPrompts < ActiveRecord::Migration[8.1]
  def change
    create_table :review_prompts, id: :string do |t|
      t.string :source_type, null: false # "urgent_request" or "booking_request"
      t.string :source_id, null: false
      t.string :user_id, null: false # who should write the review
      t.string :counterpart_user_id, null: false # who they'd be reviewing
      t.string :counterpart_name, null: false # denormalized for the email/notification copy
      t.datetime :notified_at
      t.datetime :reminded_at
      t.datetime :completed_at
      t.timestamps
    end

    add_index :review_prompts, %i[source_type source_id user_id], unique: true, name: "index_review_prompts_on_source_and_user"
    add_index :review_prompts, :user_id
    add_foreign_key :review_prompts, :users, column: :user_id
    add_foreign_key :review_prompts, :users, column: :counterpart_user_id
  end
end
