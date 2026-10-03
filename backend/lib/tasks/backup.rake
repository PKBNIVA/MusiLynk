# Database dump and restore drill (DatabaseBackup; runbook docs/ops/backups.md).
#
#   bin/rails "backup:dump[tmp/backups/musilynk.dump]"   # local file (default tmp/backups/musilynk-<UTC stamp>.dump)
#   bin/rails "backup:dump[r2]"                          # dump to a temp file, copy to BACKUP_BUCKET, prune old copies
#   bin/rails "backup:verify[tmp/backups/musilynk.dump]" # restore into a scratch database, compare row counts
#
# verify uses SCRATCH_DATABASE_URL when set (required in production) and otherwise creates and drops
# a temporary database on the same server. No connection detail is ever printed.
namespace :backup do
  desc "pg_dump -Fc the database to a local path, or to BACKUP_BUCKET with [r2]"
  task :dump, [:target] => :environment do |_task, args|
    target = args[:target].presence
    stamp = Time.current.utc.strftime("%Y%m%dT%H%M%SZ")
    if target == "r2"
      DatabaseBackup.ensure_upload_ready!
      Dir.mktmpdir("musilynk-backup") do |dir|
        result = DatabaseBackup.dump(File.join(dir, "musilynk-#{stamp}.dump"))
        keys = DatabaseBackup.upload(result.path)
        pruned = DatabaseBackup.prune
        puts "backup:dump: #{result.tables} tables, #{result.rows} rows, #{result.bytes} bytes -> #{keys.join(', ')} (pruned #{pruned} old objects)"
      end
    else
      result = DatabaseBackup.dump(target || Rails.root.join("tmp/backups/musilynk-#{stamp}.dump"))
      puts "backup:dump: #{result.tables} tables, #{result.rows} rows, #{result.bytes} bytes -> #{result.path} (+ #{File.basename(result.manifest_path)})"
    end
  end

  desc "Restore a dump into a scratch database and compare the biggest tables' row counts"
  task :verify, [:path] => :environment do |_task, args|
    path = args[:path].presence or abort("usage: bin/rails \"backup:verify[PATH_TO_DUMP]\"")
    scratch_url = ENV["SCRATCH_DATABASE_URL"].presence
    scratch = scratch_url && ActiveRecord::DatabaseConfigurations::ConnectionUrlResolver.new(scratch_url).to_hash.symbolize_keys
    if scratch && scratch.values_at(:host, :port, :database) == ActiveRecord::Base.connection_db_config.configuration_hash.values_at(:host, :port, :database)
      abort "backup:verify: SCRATCH_DATABASE_URL is this app's own database; refusing to restore over it."
    end
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    checks = DatabaseBackup.verify(path, scratch:)
    seconds = (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started).round(1)
    width = [checks.map { _1.table.length }.max.to_i, 5].max
    puts "| #{'table'.ljust(width)} | source rows | restored rows | match |"
    puts "| #{'-' * width} | ----------: | ------------: | ----- |"
    checks.each { puts "| #{_1.table.ljust(width)} | #{_1.source.to_s.rjust(11)} | #{_1.restored.to_s.rjust(13)} | #{_1.ok? ? 'yes' : 'NO'} |" }
    failed = checks.reject(&:ok?)
    puts "backup:verify: restored and checked #{checks.size} tables in #{seconds}s; #{failed.size} mismatches"
    abort "backup:verify: row counts differ for #{failed.map(&:table).join(', ')}" if failed.any?
  end
end
