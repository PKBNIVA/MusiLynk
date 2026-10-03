# The weekly backup's GoodJob cron entry (BackupToR2Job, docs/ops/backups.md). Plain Ruby, no
# autoloading: config/initializers/good_job.rb requires it while the app is still booting.
module BackupSchedule
  # Sunday 03:00 IST = Saturday 21:30 UTC.
  CRON = "30 21 * * 6".freeze

  module_function

  # The entry, or nil (job not registered) unless BACKUP_BUCKET is set.
  def cron_entry(env: ENV)
    return nil if env["BACKUP_BUCKET"].to_s.strip.empty?
    { cron: CRON, class: "BackupToR2Job", description: "Dump the database to BACKUP_BUCKET (backups/) and delete copies older than the retention window" }
  end
end
