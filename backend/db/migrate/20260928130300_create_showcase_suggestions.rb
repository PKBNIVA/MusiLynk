# The "review changes" inbox. When a work sample or career entry is added or edited, ShowcaseSync
# re-evaluates the owner's portfolios and resumes: rule matches join on their own, near misses
# become pending suggestions here ("add this item to that portfolio", "tag this item as jazz").
# One row per (target, subject, kind), so a rejected suggestion is not raised again.
class CreateShowcaseSuggestions < ActiveRecord::Migration[8.1]
  def change
    create_table :showcase_suggestions, id: :string do |t|
      # Whose inbox: the identity that owns the target ("user", "organization" or "act").
      t.string :owner_type, null: false
      t.string :owner_id, null: false
      # What would change: a portfolio or resume (kind "include"), or a work sample (kind "tags").
      t.string :target_type, null: false
      t.string :target_id, null: false
      # What the suggestion is about: a portfolio_item or a career_entry.
      t.string :subject_type, null: false
      t.string :subject_id, null: false
      t.string :kind, null: false
      t.jsonb :payload, null: false, default: {}
      t.string :reason
      t.string :status, null: false, default: "pending"
      t.datetime :resolved_at
      t.timestamps
    end
    add_index :showcase_suggestions, %i[target_type target_id subject_type subject_id kind], unique: true, name: "index_showcase_suggestions_uniqueness"
    add_index :showcase_suggestions, %i[owner_type owner_id status]
    add_index :showcase_suggestions, %i[subject_type subject_id]
  end
end
