# Records when a person agreed to the Terms and Privacy Policy at sign-up (India's DPDP Act asks
# for consent that can be shown later). Nullable: accounts created before this change have no
# recorded consent, and nothing is backfilled.
#
# sign_in_codes.pending_consented_at carries the agreement from the sign-up code request to the
# account the verified code creates.
#
# Lock profile: two nullable columns with no default, a catalog-only change on PostgreSQL;
# lock_timeout makes the migration fail fast rather than queue.
class AddSignupConsent < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :users, :consented_at, :datetime
    add_column :sign_in_codes, :pending_consented_at, :datetime
  end
end
