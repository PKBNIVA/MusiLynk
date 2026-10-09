# The generated image variants of an upload (ImageVariantsJob): {"width", "height", "formats" =>
# {"webp" => [320, 768, ...], "avif" => [...]}, "generatedAt"}. Empty until the job has run; rows
# whose job failed, or that are not images, stay empty and keep serving the original alone.
class AddVariantsToUploads < ActiveRecord::Migration[8.1]
  def change
    add_column :uploads, :variants, :jsonb, null: false, default: {}
  end
end
