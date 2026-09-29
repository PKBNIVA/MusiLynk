# Supports Google sign-in and dark WhatsApp phone-code sign-in (see AuthConnection,
# PhoneOtp, GoogleOAuth). password_set_at is null for an account that has never had a
# password the person themselves chose (created via Google or an email code); AuthController
# and Account::AuthConnectionsController use it to keep at least one real sign-in method.
class AddGoogleSigninColumnsToUsers < ActiveRecord::Migration[8.1]
  def up
    add_column :users, :phone, :citext
    add_column :users, :phone_verified_at, :datetime
    add_column :users, :password_set_at, :datetime

    add_index :users, :phone, unique: true, where: "phone IS NOT NULL"

    # Every existing user signed up with a password they chose themselves.
    execute "UPDATE users SET password_set_at = created_at"
  end

  def down
    remove_index :users, :phone
    remove_column :users, :password_set_at
    remove_column :users, :phone_verified_at
    remove_column :users, :phone
  end
end
