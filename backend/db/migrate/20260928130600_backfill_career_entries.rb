# Seeds each person's career record (career_entries) from the profile lists that map cleanly:
# skills, software and instruments become "skill" entries (software and instruments tagged as
# such), credits become "credit" entries (a trailing "(2021)" becomes the year), gear becomes
# "gear" and languages become "language". The profile's free-text experience ("5 years") does not
# map to an entry and is left alone.
# Copies only: profiles are never modified. Idempotent (people who already have any career entry
# are skipped), batched, one short insert per person. Rollback deletes only backfilled rows.
class BackfillCareerEntries < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  BATCH_SIZE = 500
  PER_LIST = 50
  YEAR_SUFFIX = /\s*\((\d{4})\)\s*\z/

  class BackfillProfile < ActiveRecord::Base
    self.table_name = "profiles"
    self.primary_key = "user_id"
  end

  class BackfillEntry < ActiveRecord::Base
    self.table_name = "career_entries"
  end

  def up
    BackfillProfile.where("NOT EXISTS (SELECT 1 FROM career_entries WHERE career_entries.user_id = profiles.user_id)")
      .find_each(batch_size: BATCH_SIZE) { backfill(_1) }
  end

  def down
    BackfillEntry.where(backfilled: true).in_batches(of: BATCH_SIZE) { _1.delete_all }
  end

  private

  def backfill(profile)
    now = Time.current
    rows = []
    add = lambda do |kind, fields, tags = []|
      rows << { id: "care_#{SecureRandom.uuid}", user_id: profile.user_id, kind:, fields:, tags:, position: rows.length,
        backfilled: true, created_at: now, updated_at: now }
    end
    strings(profile.skills).each { add.call("skill", { "name" => _1.first(60) }) }
    strings(profile.software).each { add.call("skill", { "name" => _1.first(60) }, ["software"]) }
    strings(profile.instruments).each { add.call("skill", { "name" => _1.first(60) }, ["instrument"]) }
    strings(profile.credits).each do |credit|
      year = credit[YEAR_SUFFIX, 1]&.to_i
      title = credit.sub(YEAR_SUFFIX, "").strip.presence || credit
      add.call("credit", { "title" => title.first(160), "year" => (year if year&.between?(1900, 2100)) }.compact)
    end
    strings(profile.gear).each { add.call("gear", { "name" => _1.first(120) }) }
    strings(profile.languages).each { add.call("language", { "name" => _1.first(60) }) }
    return if rows.empty?

    BackfillEntry.transaction do
      # Re-checked in the transaction: the person may have started their record meanwhile.
      next if BackfillEntry.exists?(user_id: profile.user_id)
      BackfillEntry.insert_all!(rows)
    end
  end

  def strings(value)
    list = value.is_a?(String) ? JSON.parse(value) : value
    Array(list).select { _1.is_a?(String) }.map(&:strip).reject(&:empty?).uniq.first(PER_LIST)
  rescue JSON::ParserError
    []
  end
end
