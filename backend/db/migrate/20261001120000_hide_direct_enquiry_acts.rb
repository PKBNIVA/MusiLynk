# The solo act behind quotes asked of a musician directly used to be "inactive" with a
# "Direct enquiries" tagline, so it showed up in My acts and could be activated into a public
# listing named after the musician. It is now "hidden" (never listed, never managed by the
# owner). Existing rows are moved over; their bookings keep pointing at the same act.
#
# Lock profile: one UPDATE of the few rows matching the marker (no table rewrite, no schema change).
class HideDirectEnquiryActs < ActiveRecord::Migration[8.1]
  MARKER = "Direct enquiries".freeze

  def up
    execute "SET LOCAL lock_timeout = '5s'"
    execute <<~SQL.squish
      UPDATE acts SET status = 'hidden', updated_at = now()
      WHERE status = 'inactive' AND act_type = 'solo' AND tagline = #{connection.quote(MARKER)}
    SQL
  end

  def down
    execute <<~SQL.squish
      UPDATE acts SET status = 'inactive', updated_at = now()
      WHERE status = 'hidden' AND act_type = 'solo' AND tagline = #{connection.quote(MARKER)}
    SQL
  end
end
