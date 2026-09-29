# Early Access Pro (first 50 hirers): a "status" value of "early_access" behaves like an active
# Pro plan until Subscription#trial_ends_at (reused as the early-access end date), then reverts to
# free (see Entitlements#effective?). `early_access` on the row is set once, at grant time, and is
# never cleared on revoke — it is the durable "was this ever an early-access grant" marker the
# admin seat count reads (Admin::UsersController#grant_early_access), independent of the current
# status.
#
# Lock profile: one new column (default backfilled instantly) plus swapping the status check
# constraint; both are fast, in-place operations on a small table.
class AddEarlyAccessToSubscriptions < ActiveRecord::Migration[8.1]
  def change
    reversible { |direction| direction.up { execute "SET LOCAL lock_timeout = '5s'" } }

    add_column :subscriptions, :early_access, :boolean, default: false, null: false

    remove_check_constraint :subscriptions, name: "subscriptions_status_valid"
    add_check_constraint :subscriptions,
      "status::text = ANY (ARRAY['pending'::character varying, 'trialing'::character varying, 'active'::character varying, 'past_due'::character varying, 'cancelled'::character varying, 'early_access'::character varying]::text[])",
      name: "subscriptions_status_valid"
  end
end
