#!/usr/bin/env bash
# Dump the production database to an encrypted, checksummed file plus a manifest
# of per-table row counts that restore-verify.sh checks the restored copy against.
#
#   DATABASE_URL=postgres://... BACKUP_PASSPHRASE=... scripts/db/backup.sh OUT_DIR
#
# Writes OUT_DIR/musilynk-<UTC timestamp>.dump.gpg, .dump.sha256 and .manifest.tsv.
# The plaintext dump is deleted once it is encrypted.
set -euo pipefail

out_dir=${1:?usage: backup.sh OUT_DIR}
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"

mkdir -p "$out_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
base="$out_dir/musilynk-$stamp"

server_version=$(psql "$DATABASE_URL" -XAtc "show server_version")
echo "Source server: PostgreSQL $server_version; pg_dump: $(pg_dump --version)"

# Custom format: compressed, and pg_restore can list and selectively restore it.
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-privileges --file="$base.dump"

# Row counts are read after the dump, so a write in between shows up as a count
# difference; restore-verify.sh reports those as warnings, not failures.
psql "$DATABASE_URL" -XAt -F $'\t' -f - > "$base.manifest.tsv" <<'SQL'
select format('select %L, count(*) from %I.%I', table_schema || '.' || table_name, table_schema, table_name)
from information_schema.tables
where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')
order by 1
\gexec
SQL

(cd "$out_dir" && sha256sum "$(basename "$base.dump")" > "$(basename "$base.dump.sha256")")

gpg --batch --yes --quiet --symmetric --cipher-algo AES256 \
  --passphrase-fd 3 --output "$base.dump.gpg" "$base.dump" 3<<<"$BACKUP_PASSPHRASE"
rm -f "$base.dump"

echo "Wrote $base.dump.gpg ($(du -h "$base.dump.gpg" | cut -f1)), $(wc -l < "$base.manifest.tsv") tables in manifest"
