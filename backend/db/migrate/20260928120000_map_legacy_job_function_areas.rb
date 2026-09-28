# Jobs and job alerts saved before the shared taxonomy (config/search_taxonomy.yml) used function
# names the posting form never offered ("Production", "Live Sound", ...), so filtering by the
# posted name missed them. Rewrite them to the current names. Idempotent: rows already on a
# current name are untouched, so it can be re-run. The mapping is frozen here on purpose; the
# filters keep accepting the old spellings (Search::Taxonomy.function_spellings) either way.
# Every rewritten row's original name and timestamp is first copied to
# legacy_function_area_backups, so rolling back restores production data exactly.
class MapLegacyJobFunctionAreas < ActiveRecord::Migration[8.1]
  MAPPING = {
    "Production" => "Music Production",
    "Audio Engineering" => "Recording & Studio",
    "Composition" => "Composition & Songwriting",
    "Live Sound" => "Live Sound & Audio",
    "Live & Touring" => "Tour & Production Management",
    "Touring" => "Tour & Production Management",
    "Technical" => "Stage & Technical",
    "Management" => "Artist Management",
    "A&R" => "A&R & Label",
    "Label Operations" => "A&R & Label",
    "Marketing & PR" => "Marketing / PR / Content",
    "Publishing & Rights" => "Publishing / Rights / Royalties"
  }.freeze

  def up
    unless table_exists?(:legacy_function_area_backups)
      create_table :legacy_function_area_backups do |t|
        t.string :source_table, null: false
        t.string :record_id, null: false
        t.string :function_area, null: false
        t.datetime :record_updated_at
        t.datetime :created_at, null: false, default: -> { "CURRENT_TIMESTAMP" }
      end
      add_index :legacy_function_area_backups, %i[source_table record_id], unique: true, name: "index_legacy_function_area_backups_on_record"
    end

    %w[jobs job_alerts].each do |table|
      MAPPING.each do |legacy, current|
        execute <<~SQL.squish
          INSERT INTO legacy_function_area_backups (source_table, record_id, function_area, record_updated_at)
          SELECT #{quote(table)}, id, function_area, updated_at FROM #{table} WHERE function_area = #{quote(legacy)}
          ON CONFLICT (source_table, record_id) DO NOTHING
        SQL
        execute <<~SQL.squish
          UPDATE #{table} SET function_area = #{quote(current)}, updated_at = CURRENT_TIMESTAMP
          WHERE function_area = #{quote(legacy)}
        SQL
      end
    end
  end

  # Restores each rewritten row's original name and timestamp, then drops the backup.
  def down
    return unless table_exists?(:legacy_function_area_backups)

    %w[jobs job_alerts].each do |table|
      execute <<~SQL.squish
        UPDATE #{table} SET function_area = b.function_area, updated_at = COALESCE(b.record_updated_at, #{table}.updated_at)
        FROM legacy_function_area_backups b
        WHERE b.source_table = #{quote(table)} AND b.record_id = #{table}.id
      SQL
    end
    drop_table :legacy_function_area_backups
  end

  private

  def quote(value) = connection.quote(value)
end
