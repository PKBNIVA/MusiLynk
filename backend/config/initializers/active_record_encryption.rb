# Column-level encryption for AuthConnection#access_token / #refresh_token (Google OAuth
# tokens). Configured from Railway env vars in every environment; development and test fall
# back to fixed dummy keys so a fresh clone runs immediately, without ever using those dummy
# keys in production.
#
# Owner action (see PR body): generate real values with `bin/rails db:encryption:init` and set
# them as Railway variables, never pasted into chat:
#   ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY
#   ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY
#   ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT
DEV_TEST_DUMMY_ENCRYPTION_KEYS = {
  primary_key: "dev-test-only-primary-key-do-not-use-in-prod",
  deterministic_key: "dev-test-only-deterministic-key-do-not-use",
  key_derivation_salt: "dev-test-only-key-derivation-salt-do-not-use"
}.freeze

Rails.application.config.to_prepare do
  primary_key = ENV["ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"].presence
  deterministic_key = ENV["ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY"].presence
  key_derivation_salt = ENV["ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"].presence

  if primary_key.nil? && deterministic_key.nil? && key_derivation_salt.nil? && !Rails.env.production?
    primary_key = DEV_TEST_DUMMY_ENCRYPTION_KEYS[:primary_key]
    deterministic_key = DEV_TEST_DUMMY_ENCRYPTION_KEYS[:deterministic_key]
    key_derivation_salt = DEV_TEST_DUMMY_ENCRYPTION_KEYS[:key_derivation_salt]
  end

  if primary_key && deterministic_key && key_derivation_salt
    ActiveRecord::Encryption.configure(primary_key:, deterministic_key:, key_derivation_salt:)
  elsif Rails.env.production?
    Rails.logger.error({ event: "active_record_encryption_not_configured" }.to_json)
  end
end
