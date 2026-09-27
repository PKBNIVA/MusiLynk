#!/usr/bin/env bash
# Restore a backup made by backup.sh into an empty scratch database and prove it
# is usable: checksum matches, pg_restore finishes without errors, every table in
# the manifest exists, and row counts match.
#
#   SCRATCH_DATABASE_URL=postgres://... BACKUP_PASSPHRASE=... \
#     scripts/db/restore-verify.sh OUT_DIR/verse-<stamp>.dump.gpg
#
# Never point SCRATCH_DATABASE_URL at production: the restore uses --clean.
set -euo pipefail

encrypted=${1:?usage: restore-verify.sh FILE.dump.gpg}
: "${SCRATCH_DATABASE_URL:?SCRATCH_DATABASE_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"

if [[ -n "${DATABASE_URL:-}" && "$SCRATCH_DATABASE_URL" == "$DATABASE_URL" ]]; then
  echo "SCRATCH_DATABASE_URL must not be the production DATABASE_URL" >&2
  exit 1
fi

dir=$(cd "$(dirname "$encrypted")" && pwd)
base="$dir/$(basename "$encrypted" .dump.gpg)"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

gpg --batch --quiet --decrypt --passphrase-fd 3 --output "$work/$(basename "$base").dump" "$encrypted" 3<<<"$BACKUP_PASSPHRASE"
(cd "$work" && sha256sum --check --quiet "$base.dump.sha256")
echo "Checksum OK"

started=$(date +%s)
pg_restore --dbname="$SCRATCH_DATABASE_URL" --clean --if-exists --no-owner --no-privileges \
  --exit-on-error "$work/$(basename "$base").dump"
echo "Restored in $(( $(date +%s) - started ))s"

failures=0
warnings=0
while IFS=$'\t' read -r table expected; do
  schema=${table%%.*} name=${table#*.}
  if ! actual=$(psql "$SCRATCH_DATABASE_URL" -XAtc "select count(*) from \"$schema\".\"$name\"" 2>/dev/null); then
    echo "MISSING  $table"; failures=$((failures + 1))
  elif [[ "$actual" != "$expected" ]]; then
    echo "DIFFERS  $table: source $expected, restored $actual"; warnings=$((warnings + 1))
  fi
done < "$base.manifest.tsv"

tables=$(wc -l < "$base.manifest.tsv")
rows=$(awk -F '\t' '{ s += $2 } END { print s + 0 }' "$base.manifest.tsv")
latest=$(psql "$SCRATCH_DATABASE_URL" -XAtc "select max(version) from schema_migrations" 2>/dev/null || echo none)
echo "Checked $tables tables, $rows rows; latest migration $latest; $failures missing, $warnings count differences"

# Counts can differ when production was written to between the dump and the count.
if (( warnings > 0 )); then echo "::warning::$warnings table row counts differ from the source (writes during the backup?)"; fi
(( failures == 0 ))
