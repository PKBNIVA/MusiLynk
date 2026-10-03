# Weekly in-app database backup to object storage (cron in config/initializers/good_job.rb, Sunday
# 03:00 IST, `scheduled` pool). Off unless BACKUP_BUCKET is set: the cron entry is not even
# registered, and a run without it does nothing. Dumps to a temp file, copies the dump and its
# row-count manifest under `backups/`, then deletes copies older than config/backups.yml
# retention_days. Logs sizes and counts only. The nightly GitHub workflow (.github/workflows/db-backup.yml)
# is the primary, restore-tested backup; this is the second copy (docs/ops/backups.md).
class BackupToR2Job < ApplicationJob
  queue_as :scheduled

  def perform
    return log(:skipped, reason: "BACKUP_BUCKET not set") unless DatabaseBackup.enabled?
    DatabaseBackup.ensure_upload_ready! # fails before dumping when BACKUP_PASSPHRASE is missing

    Dir.mktmpdir("musilynk-backup") do |dir|
      result = DatabaseBackup.dump(File.join(dir, "musilynk-#{Time.current.utc.strftime('%Y%m%dT%H%M%SZ')}.dump"))
      keys = DatabaseBackup.upload(result.path)
      pruned = DatabaseBackup.prune
      log(:uploaded, objects: keys.size, bytes: result.bytes, tables: result.tables, rows: result.rows, pruned:)
    end
  end

  private

  def log(status, **fields) = Rails.logger.info({ event: "database_backup", status:, **fields }.to_json)
end
