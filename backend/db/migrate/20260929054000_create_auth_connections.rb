# Linked third-party sign-in / API identities (Google today; YouTube, Spotify, Instagram
# later) for a MusiLynk owner. The owner is polymorphic so a Page (Organization, Act) can hold
# its own connections in the future, not only a User. See AuthConnection and GoogleOAuth.
class CreateAuthConnections < ActiveRecord::Migration[8.1]
  def change
    create_table :auth_connections, id: :string do |t|
      t.string :owner_type, null: false
      t.string :owner_id, null: false
      t.string :provider, null: false
      t.string :provider_uid, null: false
      t.citext :email
      t.boolean :email_verified, default: false, null: false
      t.string :display_name
      t.string :avatar_url
      # Encrypted at the application layer (ActiveRecord::Encryption; see
      # config/initializers/active_record_encryption.rb). Never present in the raw column.
      t.text :access_token
      t.text :refresh_token
      t.jsonb :scopes, default: [], null: false
      t.datetime :expires_at
      t.jsonb :raw, default: {}, null: false
      t.datetime :last_synced_at
      t.timestamps
    end

    add_index :auth_connections, %i[provider provider_uid], unique: true, name: "index_auth_connections_on_provider_and_uid"
    add_index :auth_connections, %i[owner_type owner_id], name: "index_auth_connections_on_owner"
  end
end
