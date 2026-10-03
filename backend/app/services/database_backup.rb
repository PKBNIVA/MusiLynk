require "open3"

# pg_dump / pg_restore around the app's own database, for `bin/rails backup:dump`, `backup:verify`
# and the weekly BackupToR2Job (settings in config/backups.yml, runbook docs/ops/backups.md).
#
# Connection details reach pg_dump and pg_restore only through PG* environment variables of the
# child process: they are never on a command line (visible in `ps`) and never printed or logged.
#
# A dump is written in custom format (-Fc) next to a manifest (<dump>.manifest.json) of exact row
# counts per table, read right after the dump, and the dump's SHA-256; `verify` restores into a
# scratch database and compares the biggest tables against it. Copies sent to the bucket are
# encrypted first (AES-256, OpenSSL `enc` format, key from BACKUP_PASSPHRASE).
class DatabaseBackup
  class Error < StandardError; end

  Result = Data.define(:path, :manifest_path, :bytes, :tables, :rows)
  Check = Data.define(:table, :source, :restored) do
    def ok? = source == restored
  end

  CONFIG_PATH = Rails.root.join("config/backups.yml")
  # Encrypted copies use OpenSSL `enc` format, so they decrypt with stock tools and no app code:
  #   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_PASSPHRASE -in X.dump.enc -out X.dump
  # The manifest's sha256 (of the plain dump) catches a corrupted or tampered copy.
  PBKDF2_ITERATIONS = 200_000
  CHUNK = 1 << 20

  # Row counts over a plain PG connection to the scratch database.
  Counter = Struct.new(:pg) do
    def quote_table_name(name) = pg.quote_ident(name)
    def select_value(sql) = pg.exec(sql).getvalue(0, 0)
  end

  class << self
    def config = @config ||= YAML.safe_load_file(CONFIG_PATH).freeze
    def bucket = ENV["BACKUP_BUCKET"].presence
    def enabled? = bucket.present?
    def passphrase = ENV["BACKUP_PASSPHRASE"].presence

    def encrypt(source, target, secret: passphrase)
      raise Error, "BACKUP_PASSPHRASE is not set." if secret.blank?
      salt = SecureRandom.random_bytes(8)
      cipher = cipher_for(:encrypt, secret, salt)
      File.open(target, "wb") do |out|
        out.write("Salted__", salt)
        File.open(source, "rb") { |io| while (chunk = io.read(CHUNK)) do out.write(cipher.update(chunk)) end }
        out.write(cipher.final)
      end
      Pathname(target)
    end

    def decrypt(source, target, secret: passphrase)
      raise Error, "BACKUP_PASSPHRASE is not set." if secret.blank?
      File.open(source, "rb") do |io|
        raise Error, "#{File.basename(source)} is not an OpenSSL-encrypted dump." unless io.read(8) == "Salted__"
        cipher = cipher_for(:decrypt, secret, io.read(8))
        File.open(target, "wb") do |out|
          while (chunk = io.read(CHUNK)) do out.write(cipher.update(chunk)) end
          out.write(cipher.final)
        end
      end
      Pathname(target)
    rescue OpenSSL::Cipher::CipherError
      raise Error, "Could not decrypt #{File.basename(source)} (wrong BACKUP_PASSPHRASE?)."
    end

    def cipher_for(direction, secret, salt)
      material = OpenSSL::KDF.pbkdf2_hmac(secret, salt:, iterations: PBKDF2_ITERATIONS, length: 48, hash: "sha256")
      OpenSSL::Cipher.new("aes-256-cbc").tap do |cipher|
        cipher.public_send(direction)
        cipher.key = material[0, 32]
        cipher.iv = material[32, 16]
      end
    end

    # Dumps the database to `path` (custom format) and writes its manifest. The row counts are taken
    # in the same snapshot pg_dump reads (a REPEATABLE READ transaction whose exported snapshot is
    # passed to pg_dump --snapshot), so writes during the dump can never make verify disagree.
    def dump(path, db: ActiveRecord::Base.connection_db_config.configuration_hash)
      path = Pathname(path)
      FileUtils.mkdir_p(path.dirname)
      counts = with_connection(db) do |connection|
        connection.pg.exec("BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        snapshot = connection.select_value("SELECT pg_export_snapshot()")
        run!(pg_env(db), "pg_dump", "--format=custom", "--no-owner", "--no-privileges", "--snapshot=#{snapshot}", "--file=#{path}")
        table_counts(connection).tap { connection.pg.exec("COMMIT") }
      end
      manifest_path = Pathname("#{path}.manifest.json")
      manifest_path.write(JSON.pretty_generate({ createdAt: Time.current.iso8601, database: "redacted", sha256: Digest::SHA256.file(path).hexdigest, tables: counts }))
      Result.new(path:, manifest_path:, bytes: path.size, tables: counts.size, rows: counts.values.sum)
    end

    # Restores `path` into a scratch database and compares the biggest tables' row counts with the
    # dump's manifest. `scratch` is the scratch database's config hash; without one (development and
    # test only) a temporary database is created on the same server and dropped afterwards.
    # An encrypted copy (X.dump.enc, with X.dump.manifest.json beside it) is decrypted to a temp
    # file first. The dump's checksum is compared with the manifest before anything is restored.
    def verify(path, scratch: nil, limit: config.fetch("verify_tables"))
      path = path.to_s
      plain_name = path.delete_suffix(".enc")
      manifest = JSON.parse(File.read("#{plain_name}.manifest.json"))
      temporary = scratch.nil?
      raise Error, "Pass a scratch database (SCRATCH_DATABASE_URL) to verify in production." if temporary && Rails.env.production?
      workdir = Dir.mktmpdir("musilynk-verify")
      dump = path.end_with?(".enc") ? decrypt(path, File.join(workdir, File.basename(plain_name))).to_s : path
      if manifest["sha256"] && Digest::SHA256.file(dump).hexdigest != manifest["sha256"]
        raise Error, "#{File.basename(dump)} does not match its manifest checksum."
      end
      manifest = manifest.fetch("tables")
      scratch ||= create_scratch_database
      run!(pg_env(scratch), "pg_restore", "--no-owner", "--no-privileges", "--exit-on-error", "--dbname=#{scratch.fetch(:database)}", dump)
      biggest = manifest.sort_by { |table, count| [-count, table] }.first(limit)
      with_connection(scratch) do |connection|
        biggest.map { |table, count| Check.new(table:, source: count, restored: connection.select_value("SELECT COUNT(*) FROM #{connection.quote_table_name(table)}").to_i) }
      end
    ensure
      drop_scratch_database(scratch) if temporary && scratch
      FileUtils.rm_rf(workdir) if workdir
    end

    # Encrypts the dump (BACKUP_PASSPHRASE; a plain dump never leaves the machine) and copies it and
    # its manifest to BACKUP_BUCKET under the configured prefix; returns the keys.
    def upload(path)
      ensure_upload_ready!
      encrypted = encrypt(path, "#{path}.enc")
      [encrypted.to_s, "#{path}.manifest.json"].map do |file|
        key = "#{config.fetch('prefix')}#{File.basename(file)}"
        File.open(file, "rb") { |body| s3.put_object(bucket:, key:, body:) }
        size = s3.head_object(bucket:, key:).content_length
        raise Error, "Uploaded #{key} is #{size} bytes, expected #{File.size(file)}." unless size == File.size(file)
        key
      end
    end

    # Deletes this code's own objects (own_key?) older than retention_days; returns how many.
    # Anything else under the prefix is left alone.
    def prune(now: Time.current)
      raise Error, "BACKUP_BUCKET is not set." unless enabled?
      cutoff = now - config.fetch("retention_days").days
      old = []
      s3.list_objects_v2(bucket:, prefix: config.fetch("prefix")).each do |page|
        old.concat(page.contents.select { own_key?(_1.key) && _1.last_modified < cutoff }.map(&:key))
      end
      old.each_slice(1_000) { |keys| s3.delete_objects(bucket:, delete: { objects: keys.map { { key: _1 } }, quiet: true }) }
      old.size
    end

    def s3 = @s3 ||= UploadStorage.client
    attr_writer :s3

    # { table => rows } for every table in the public schema, over `connection` (a Counter).
    def table_counts(connection)
      tables = connection.pg.exec("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename").column_values(0)
      tables.to_h { [_1, connection.select_value("SELECT COUNT(*) FROM #{connection.quote_table_name(_1)}").to_i] }
    end

    # Refuses an upload before anything is dumped when the bucket or the passphrase is missing.
    def ensure_upload_ready!
      raise Error, "BACKUP_BUCKET is not set." unless enabled?
      raise Error, "BACKUP_PASSPHRASE is not set; copies are never uploaded unencrypted." if passphrase.blank?
    end

    # Only objects this code wrote: backups/musilynk-<UTC stamp>.dump.enc and its manifest.
    def own_key?(key) = key.match?(/\A#{Regexp.escape(config.fetch("prefix"))}musilynk-\d{8}T\d{6}Z\.dump(\.enc|\.manifest\.json)\z/)


    # PG* variables for a child process. Nothing here is ever printed.
    def pg_env(db)
      {
        "PGHOST" => db[:host].to_s.presence, "PGPORT" => db[:port]&.to_s, "PGUSER" => db[:username].to_s.presence,
        "PGPASSWORD" => db[:password].to_s.presence, "PGDATABASE" => db.fetch(:database).to_s, "PGSSLMODE" => db[:sslmode]&.to_s
      }.compact
    end

    private

    # Runs a client binary; on failure raises with its stderr (pg tools never echo passwords).
    def run!(env, *command)
      _out, err, status = Open3.capture3(env, *command)
      raise Error, "#{command.first} failed (exit #{status.exitstatus}): #{err.strip.first(500)}" unless status.success?
    end

    def create_scratch_database
      base = ActiveRecord::Base.connection_db_config.configuration_hash
      name = "#{base.fetch(:database)}_verify_#{Time.current.utc.strftime('%Y%m%d%H%M%S')}_#{SecureRandom.hex(2)}"
      ActiveRecord::Base.lease_connection.execute("CREATE DATABASE #{ActiveRecord::Base.lease_connection.quote_table_name(name)}")
      base.merge(database: name)
    end

    def drop_scratch_database(scratch)
      ActiveRecord::Base.lease_connection.execute("DROP DATABASE IF EXISTS #{ActiveRecord::Base.lease_connection.quote_table_name(scratch.fetch(:database))} WITH (FORCE)")
    end

    def with_connection(db)
      connection = PG.connect(**{ host: db[:host], port: db[:port], dbname: db.fetch(:database), user: db[:username], password: db[:password], sslmode: db[:sslmode] }.compact)
      yield Counter.new(connection)
    ensure
      connection&.close
    end
  end
end
