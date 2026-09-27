class AddTrustSignals < ActiveRecord::Migration[8.1]
  def change
    # Scam-pattern signals (ScamSignals::SIGNALS) found when the message was sent.
    add_column :messages, :safety_flags, :string, array: true, default: [], null: false
    add_index :messages, :created_at, where: "safety_flags <> '{}'", name: "index_messages_flagged_on_created_at"
    add_index :messages, :sender_id, where: "safety_flags <> '{}'", name: "index_messages_flagged_on_sender_id"
    # What the moderator did when closing the report (warn, suspend, dismiss) and their note.
    add_column :reports, :action_taken, :string
    add_column :reports, :resolution_note, :text
    add_index :reports, %i[entity_type entity_id]
  end
end
