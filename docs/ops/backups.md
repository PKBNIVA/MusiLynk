# Database backups and restore runbook

Checked 2026-10-03. Production is Railway Postgres (`ghcr.io/railwayapp-templates/postgres-ssl:18`,
volume `postgres-volume`, 136 MB used of 500 MB, region `sfo`).

## What exists

| Backup | Schedule | Where | Kept | Restore-tested |
| --- | --- | --- | --- | --- |
| **Railway volume backups** | none | Railway | none | n/a |
| **GitHub workflow** `.github/workflows/db-backup.yml` (primary) | nightly 03:00 IST | workflow artifact, plus `BACKUP_S3_BUCKET` when set | 30 days (artifact) | every run restores into a scratch Postgres 18 and fails if the restore fails |
| **In-app `BackupToR2Job`** (second copy, this runbook) | weekly, Sunday 03:00 IST | `BACKUP_BUCKET`, under `backups/` | 30 days (`config/backups.yml`) | by hand with `backup:verify` |

- **Railway:** read-only GraphQL checks (`volumeInstanceBackupList` and
  `volumeInstanceBackupScheduleList` on the Postgres volume instance) return no backups and no
  backup schedule, so Railway has nothing to restore from today. If the plan allows it, Railway →
  Postgres service → Volume → Backups can add a schedule; that is a settings change for the owner.
- **GitHub workflow:** the last six scheduled runs (2026-09-29 to 2026-10-03) and two manual runs
  all succeeded. A failed run opens a `backup-failure` issue. Details in `DEPLOYMENT.md`, "Backups
  and rollback".
- **In-app job:** it is off unless `BACKUP_BUCKET` is set; with it unset the cron entry is not even
  registered. It dumps with `pg_dump -Fc`, writes a row-count manifest with the dump's SHA-256,
  encrypts the dump (AES-256, OpenSSL `enc` format, key from `BACKUP_PASSPHRASE`; a plain dump never
  leaves the container), uploads both files and checks the uploaded size, then deletes objects
  under `backups/` older than 30 days. It runs on the worker's `scheduled` pool
  (`config/job_queues.yml`).

## RPO and RTO

- **RPO (data you can lose): up to 24 hours.** That is the nightly GitHub backup. If only the
  weekly in-app copy is usable, up to 7 days. There is no point-in-time recovery.
- **RTO (time to be back up): about 30 minutes**, almost all of it human steps. At current size the
  restore itself takes seconds. The drill below (595k rows, 13 MB dump) restored in 11 to 16 s.
  Plan for minutes once the data is in the GB range.

## Environment variables (names only)

| Variable | Where | What |
| --- | --- | --- |
| `BACKUP_BUCKET` | Railway, worker service (optional) | Bucket for the weekly copy. Unset means the job is off. Use a private bucket separate from uploads. |
| `BACKUP_PASSPHRASE` | Railway, worker service (required with `BACKUP_BUCKET`) | Encrypts the copies. Keep a copy in the password manager: without it the copies cannot be read. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION` | already set for uploads | The same S3/R2 credentials. The key needs write and delete access to `BACKUP_BUCKET`. |
| `SCRATCH_DATABASE_URL` | your shell only, for `backup:verify` | Database to restore into. Required in production; locally a temporary one is created and dropped. |

The production image ships `pg_dump` and `pg_restore` 18 from the PostgreSQL apt repository
(`backend/Dockerfile`, `PG_CLIENT_MAJOR`). Raise that number when Railway's Postgres major version goes up.

## Commands

```bash
cd backend
bin/rails "backup:dump[tmp/backups/musilynk.dump]"   # local dump and manifest
bin/rails "backup:dump[r2]"                          # encrypted copy to BACKUP_BUCKET, then prune
bin/rails "backup:verify[tmp/backups/musilynk.dump]" # restore into a scratch DB, compare the 10 biggest tables
BACKUP_PASSPHRASE=... bin/rails "backup:verify[musilynk-<stamp>.dump.enc]"   # an encrypted copy (manifest beside it)
```

To decrypt a copy without the app:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -md sha256 -pass env:BACKUP_PASSPHRASE -in X.dump.enc -out X.dump
```

No command prints a connection string: pg tools get the connection only through the child
process's `PG*` variables.

## Drill, 2026-10-03

Local Postgres 16 database `ml_b2` (the `perf:seed` volume: 87 tables, 595,103 rows). Steps:
`backup:dump` (12.95 MB, 8.5 s), encrypt, delete the plain dump, then `backup:verify` the
encrypted copy (decrypt, checksum, restore, compare).

| table           | source rows | restored rows | match |
| --------------- | ----------: | ------------: | ----- |
| messages        |      200000 |        200000 | yes |
| notifications   |      100000 |        100000 | yes |
| act_members     |       60000 |         60000 | yes |
| profiles        |       50000 |         50000 | yes |
| users           |       50000 |         50000 | yes |
| portfolio_items |       30000 |         30000 | yes |
| acts            |       20000 |         20000 | yes |
| conversations   |       20000 |         20000 | yes |
| posts           |       20000 |         20000 | yes |
| applications    |       10000 |         10000 | yes |

Result: 10 tables restored and checked in 10.6 s, 0 mismatches. The scratch database was dropped.

## Restore to Railway in 10 steps

Do this only to replace production data (corruption, a bad migration, an accident). Every step
is in Railway's dashboard or your own shell. Never paste the connection string into chat or tickets.

1. **Pick the backup.** Use the newest green GitHub run (Actions → Database backup → the run →
   artifact `verse-db-<run id>`), or the newest `backups/musilynk-*.dump.enc` plus its
   `.manifest.json` from `BACKUP_BUCKET`. Download it to your machine.
2. **Decrypt and verify it locally.** Use `scripts/db/restore-verify.sh` for a GitHub artifact,
   or `bin/rails "backup:verify[...]"` for an in-app copy. Do not go on unless the row counts match.
3. **Stop writes.** Railway → `musilynk-api` and `musilynk-worker` → Settings → scale to 0 replicas
   (or remove the start command). Users then see the maintenance error instead of writing to a
   database you are about to replace.
4. **Back up what is there now,** even if it is broken:
   `bin/rails "backup:dump[before-restore.dump]"` against the production URL, or run the GitHub
   workflow by hand. You can then undo the restore.
5. **Get the connection.** Railway → Postgres → Variables → `DATABASE_PUBLIC_URL` (public
   networking must be on). Export it in your shell as `TARGET_URL`; do not echo it.
6. **Check versions.** Run `pg_restore --version`; it must be at least Postgres 18 (the server's
   major version).
7. **Restore over the existing schema:**
   `pg_restore --dbname="$TARGET_URL" --clean --if-exists --no-owner --no-privileges --exit-on-error X.dump`
8. **Check it:**
   - `psql "$TARGET_URL" -XAtc "select max(version) from schema_migrations"` matches the latest
     migration of the code you will run.
   - Spot-check the counts of `users`, `profiles` and `messages` against the manifest.
9. **Start the app again.** Scale `musilynk-api` back up first and wait for `/api/readiness` to
   return 200. Then scale up `musilynk-worker`, and check `/api/health` shows the expected commit.
10. **Close out.**
    - Run the GitHub backup workflow by hand so a fresh backup of the restored state exists.
    - Write down the restore time and the data window lost (RPO) in the incident note.
    - Turn public networking back off if you enabled it only for this.

Rollback of a restore: repeat steps 3 to 9 with `before-restore.dump` from step 4.
