# Vouching: a verified musician can refer someone they've worked with by email, without any
# money changing hands. A vouch starts "invited", becomes "joined" once the invitee signs up
# through the token link (which also stamps users.vouched_by_id), and "verified" once their own
# verification request is approved. The admin verification queue reads vouched_by_id to sort
# vouched applicants first and show a "Vouched by <name>" chip.
#
# Lock profile: two new columns on users plus one new table; nothing existing is rewritten.
class CreateVouches < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :users, :vouched_by_id, :string
    add_index :users, :vouched_by_id
    add_foreign_key :users, :users, column: :vouched_by_id, on_delete: :nullify

    create_table :vouches, id: :string do |t|
      t.string :voucher_id, null: false
      t.citext :vouchee_email, null: false
      t.string :vouchee_id
      t.string :token, null: false
      t.string :status, null: false, default: "invited"
      t.timestamps
    end
    add_index :vouches, %i[voucher_id vouchee_email], unique: true, name: "idx_vouches_voucher_and_email"
    add_index :vouches, :token, unique: true
    add_index :vouches, :vouchee_id
    add_foreign_key :vouches, :users, column: :voucher_id
    add_foreign_key :vouches, :users, column: :vouchee_id, on_delete: :nullify
    add_check_constraint :vouches, "status IN ('invited', 'joined', 'verified')", name: "vouches_status_valid"
  end
end
