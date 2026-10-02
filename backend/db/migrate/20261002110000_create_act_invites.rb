# Bandmate invites: joining an act's lineup needs the musician's own consent. An invite is addressed to
# a Verse user (invitee_user_id), to an email address (invitee_email), or to nobody in particular (a
# shareable link). Only a digest of the secret token is stored.
class CreateActInvites < ActiveRecord::Migration[8.1]
  def change
    create_table :act_invites, id: :string do |t|
      t.string :act_id, null: false
      t.string :inviter_id, null: false
      t.string :kind, null: false
      t.string :invitee_user_id
      t.citext :invitee_email
      t.string :role_name, null: false
      t.string :instrument
      t.string :token_digest, null: false
      t.string :status, null: false, default: "pending"
      t.datetime :expires_at, null: false
      t.datetime :responded_at
      t.string :accepted_by_id
      t.datetime :last_sent_at
      t.integer :send_count, null: false, default: 0
      t.timestamps
    end
    add_index :act_invites, :token_digest, unique: true
    add_index :act_invites, %i[act_id status]
    add_index :act_invites, :inviter_id
    add_index :act_invites, %i[invitee_user_id status]
    add_index :act_invites, %i[invitee_email status]
    add_foreign_key :act_invites, :acts, on_delete: :cascade
    add_foreign_key :act_invites, :users, column: :inviter_id, on_delete: :cascade
    add_foreign_key :act_invites, :users, column: :invitee_user_id, on_delete: :cascade
    add_check_constraint :act_invites, "status IN ('pending','accepted','declined','revoked')", name: "act_invites_status_valid"
    add_check_constraint :act_invites, "kind IN ('user','email','link')", name: "act_invites_kind_valid"
  end
end
