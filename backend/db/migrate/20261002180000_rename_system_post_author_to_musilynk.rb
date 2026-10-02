# The Stage's platform author id was "verse" (Post::SYSTEM_AUTHOR_ID) before the MusiLynk rename.
# Moves stored system posts and comments to the new id; the old id keeps resolving through
# Post.canonical_author_id so shared links keep working. Data only, no structural change.
class RenameSystemPostAuthorToMusilynk < ActiveRecord::Migration[8.1]
  TABLES = %w[posts post_comments].freeze

  def up = rename("verse", "musilynk")

  def down = rename("musilynk", "verse")

  private

  def rename(from, to)
    TABLES.each do |table|
      execute <<~SQL.squish
        UPDATE #{table} SET author_id = #{connection.quote(to)}
        WHERE author_type = 'system' AND author_id = #{connection.quote(from)}
      SQL
    end
  end
end
