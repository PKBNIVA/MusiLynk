# Jobs and job alerts saved before the shared taxonomy (config/search_taxonomy.yml) used function
# names the posting form never offered ("Production", "Live Sound", ...), so filtering by the
# posted name missed them. Rewrite them to the current names. Idempotent: rows already on a
# current name are untouched, so it can be re-run. The mapping is frozen here on purpose; the
# filters keep accepting the old spellings (Search::Taxonomy.function_spellings) either way.
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
    %w[jobs job_alerts].each do |table|
      MAPPING.each do |legacy, current|
        execute <<~SQL.squish
          UPDATE #{table} SET function_area = #{quote(current)}, updated_at = CURRENT_TIMESTAMP
          WHERE function_area = #{quote(legacy)}
        SQL
      end
    end
  end

  # The old names carried no extra meaning, and the filters accept both, so rolling back leaves
  # the current names in place.
  def down; end

  private

  def quote(value) = connection.quote(value)
end
