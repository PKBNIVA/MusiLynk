# A person's career record (career_entries) is the single master copy of their experience,
# credits, education, skills, gear, languages, links and awards. Resumes are views over it:
# entries matching `rules`, plus pins, minus exclusions, grouped by `section_order`, with
# headline and summary as overrides (NULL inherits the profile). An optional PDF comes from the
# existing uploads table.
class CreateCareerEntriesAndResumes < ActiveRecord::Migration[8.1]
  def change
    create_table :career_entries, id: :string do |t|
      t.references :user, type: :string, null: false, foreign_key: true, index: false
      t.string :kind, null: false
      t.jsonb :fields, null: false, default: {}
      t.date :start_on
      t.date :end_on
      t.jsonb :tags, null: false, default: []
      t.integer :position, null: false, default: 0
      # Rows copied from profiles by the one-time backfill, so its rollback removes only those.
      t.boolean :backfilled, null: false, default: false
      t.timestamps
    end
    add_index :career_entries, %i[user_id kind]

    create_table :resumes, id: :string do |t|
      t.references :user, type: :string, null: false, foreign_key: true
      t.string :title, null: false
      t.string :target_role
      t.string :headline
      t.text :summary
      t.jsonb :rules, null: false, default: {}
      t.jsonb :pinned_entry_ids, null: false, default: []
      t.jsonb :excluded_entry_ids, null: false, default: []
      t.jsonb :entry_order, null: false, default: []
      t.jsonb :section_order, null: false, default: []
      t.references :upload, type: :string, foreign_key: { on_delete: :nullify }
      t.boolean :is_default, null: false, default: false
      t.timestamps
    end
    add_index :resumes, :user_id, unique: true, where: "is_default", name: "index_resumes_one_default_per_user"
  end
end
