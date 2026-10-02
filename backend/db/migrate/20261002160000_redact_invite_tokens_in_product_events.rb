# Invite links (/invites/<token>) were recorded verbatim as the page and route_change path of
# product events. Redacts what is already stored. The original values cannot be restored, so down is a no-op.
class RedactInviteTokensInProductEvents < ActiveRecord::Migration[8.1]
  def up
    execute <<~SQL.squish
      UPDATE product_events SET page = '/invites/:token'
      WHERE page ~ '^/invites/'
    SQL
    execute <<~SQL.squish
      UPDATE product_events SET props = jsonb_set(props, '{path}', to_jsonb(regexp_replace(props->>'path', '^/invites/.*$', '/invites/:token')))
      WHERE props->>'path' ~ '^/invites/'
    SQL
  end

  def down; end
end
