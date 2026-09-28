# An application can carry the portfolio and resume the applicant chose to send. The ids point at
# the live records (and are cleared if those are deleted); materials_snapshot keeps exactly what
# the employer was sent at apply time, so later edits never change it.
class AddMaterialsToApplications < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    add_column :applications, :portfolio_id, :string, if_not_exists: true
    add_column :applications, :resume_id, :string, if_not_exists: true
    add_column :applications, :materials_snapshot, :jsonb, if_not_exists: true
    add_index :applications, :portfolio_id, where: "portfolio_id IS NOT NULL", algorithm: :concurrently, if_not_exists: true
    add_index :applications, :resume_id, where: "resume_id IS NOT NULL", algorithm: :concurrently, if_not_exists: true
    # The upload sweep keeps a resume PDF an employer was sent (see Upload.unreferenced).
    add_index :applications, "(materials_snapshot #>> '{resume,uploadId}')", name: "index_applications_on_snapshot_upload_id",
      where: "materials_snapshot IS NOT NULL", algorithm: :concurrently, if_not_exists: true
    # New, empty columns: validating the constraints scans nothing that can fail, and NOT VALID
    # first keeps the lock on applications short.
    add_foreign_key :applications, :portfolios, on_delete: :nullify, validate: false
    add_foreign_key :applications, :resumes, on_delete: :nullify, validate: false
    validate_foreign_key :applications, :portfolios
    validate_foreign_key :applications, :resumes
  end

  def down
    remove_foreign_key :applications, :resumes, if_exists: true
    remove_foreign_key :applications, :portfolios, if_exists: true
    remove_column :applications, :materials_snapshot, if_exists: true
    remove_column :applications, :resume_id, if_exists: true
    remove_column :applications, :portfolio_id, if_exists: true
  end
end
