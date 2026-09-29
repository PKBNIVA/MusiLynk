# A single-use, six-digit WhatsApp sign-in code, mirroring SignInCode's email design (only
# an HMAC of the code is stored). Kept as its own table rather than widening SignInCode,
# since a phone code is never mixed with an email address.
class CreatePhoneOtps < ActiveRecord::Migration[8.1]
  def change
    create_table :phone_otps, id: :string do |t|
      t.citext :phone, null: false
      t.string :code_digest, null: false
      t.string :pending_name
      t.string :pending_role
      t.integer :attempts, default: 0, null: false
      t.datetime :expires_at, null: false
      t.datetime :used_at
      t.datetime :pending_consented_at
      t.timestamps
    end

    add_index :phone_otps, %i[phone created_at], name: "index_phone_otps_on_phone_and_created_at"
    add_index :phone_otps, :expires_at
  end
end
