# One row per saved version of an account's billing details. An edit never updates a row: it
# inserts the next version and retires the previous one (current = false), so every invoice keeps
# pointing at the details it was issued with. Exactly one current row per user (partial unique index).
class CreateBillingProfiles < ActiveRecord::Migration[8.1]
  def change
    create_table :billing_profiles, id: :string do |t|
      t.references :user, type: :string, null: false, foreign_key: true
      t.integer :version, null: false
      t.boolean :current, null: false, default: true
      t.string :buyer_type, null: false, default: "individual"
      t.string :legal_name, null: false
      t.string :gstin
      t.string :pan
      t.string :address_line1, null: false
      t.string :address_line2
      t.string :city, null: false
      t.string :state_code, null: false
      t.string :postal_code, null: false
      t.string :country, null: false, default: "India"
      t.string :billing_email, null: false
      t.string :po_reference
      t.timestamps
    end

    add_index :billing_profiles, %i[user_id version], unique: true
    add_index :billing_profiles, :user_id, unique: true, where: "current", name: "index_billing_profiles_one_current_per_user"
    add_check_constraint :billing_profiles, "buyer_type IN ('individual','business')", name: "billing_profiles_buyer_type_valid"
  end
end
