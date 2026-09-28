# Queue for the classify_portfolio_item task, submitted through the Anthropic Message Batches
# API (50% cheaper than synchronous calls). AiBatchSubmitJob (GoodJob, every 30 minutes) submits
# queued rows as one batch and, on a later run, polls submitted batches and ingests results.
#
# Lock profile: a new, empty table plus its indexes; nothing existing is locked except the
# catalog, and lock_timeout makes the migration fail fast rather than queue.
class CreateAiBatchClassifications < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    create_table :ai_batch_classifications, id: :string do |t|
      t.string :portfolio_item_id, null: false
      t.string :account_type, null: false
      t.string :account_id, null: false
      t.string :status, null: false, default: "queued"
      t.string :batch_id
      t.string :custom_id
      t.jsonb :input_context, default: {}, null: false
      t.jsonb :result
      t.string :error
      t.datetime :submitted_at
      t.datetime :completed_at
      t.timestamps
    end

    add_index :ai_batch_classifications, :status
    add_index :ai_batch_classifications, :batch_id
    add_index :ai_batch_classifications, :portfolio_item_id

    add_check_constraint :ai_batch_classifications,
      "status::text = ANY (ARRAY['queued'::character varying, 'submitted'::character varying, 'completed'::character varying, 'failed'::character varying]::text[])",
      name: "ai_batch_classifications_status_valid"
  end
end
