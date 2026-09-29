# Consent flag for the growth loop: a verified musician's approval is announced on the Stage
# and their profile gets a shareable badge card only while this is true. Defaults to true (the
# musician can turn it off in profile settings) per the work package.
class AddShareVerificationPubliclyToProfiles < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :profiles, :share_verification_publicly, :boolean, null: false, default: true
  end
end
