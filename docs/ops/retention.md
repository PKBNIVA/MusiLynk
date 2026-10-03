# Data retention

How long each kind of record is kept, and how old ones are removed. The windows live in one file,
`backend/config/retention.yml`. `RetentionSweepJob` applies them nightly (cron 22:17 UTC = 03:47 IST,
GoodJob `scheduled` pool, `app/services/retention.rb`).

## What is deleted, and when

The deletion time is "after" + "days". A row exactly at the boundary is kept until the next night.

| Rule | After | Days | What goes | What stays |
| --- | --- | ---: | --- | --- |
| `sign_in_codes` | the code expired | 1 | Emailed sign-in codes | Codes that have not expired yet |
| `sessions` | the session expired (idle timeout or absolute lifetime) | 7 | Session rows (token digests) | Live sessions |
| `notifications` | the person read it | 90 | Read in-app notifications | Unread notifications, however old |
| `problem_report_screenshots` | an admin handled the report (`handled_at`, or the filing time for a report handled before that column existed) | 30 | The screenshot file and its blob row, for triaged or resolved reports only | The report (text, page, status, admin notes); every screenshot of a report still `new`, however old |
| `product_events` | the event happened | 180 | Analytics and funnel events (the admin funnel reads 7 or 30 days back, the founder report two weeks) | Newer events |
| `erased_account_residue` | the account was erased | 30 | The erased person's analytics events, and other people's "recently viewed" entries that still carry the old name | The anonymised user row, messages already sent, billing and audit records (`AccountErasure` keeps these on purpose) |
| `good_jobs` | the job finished (succeeded or discarded) | 14 | Finished GoodJob jobs and their executions | Queued and running jobs |

Notes:

- **Erasure time** is the user row's `updated_at`. `AccountErasure` sets it when it anonymises the
  row (status `deleted`). A later edit to that row only delays this cleanup; it never brings it forward.
- **GoodJob** also runs its own periodic cleanup. `config/initializers/good_job.rb` sets that cleanup
  to the same 14 days from this file, so the two never disagree.
- **Email tokens** (password reset and verification) stay with `AuthCleanupJob`: 7 days after they
  expire or are used. Sessions and sign-in codes moved from that job to this sweep.
- **Profile-view milestone:** the "100 profile views" email counts `profiles.profile_view_count`, a
  stored total. It was backfilled from all `profile_view` events at deploy and is incremented on
  each new view, so expiring old events never changes it.
- **Session cap:** sign-in keeps at most 10 *live* sessions per person. Expired sessions waiting for
  this sweep do not count toward the cap.

## Limits

- Rows go in batches of `batch_size` (1,000). Each batch is selected through an index:
  `product_events(created_at)`, the partial index `notifications(read_at) WHERE read_at IS NOT NULL`,
  `sign_in_codes(expires_at)`, `good_jobs(finished_at)`. Sessions and screenshots have small tables.
- Each rule deletes at most `max_per_run` (50,000) rows or files per night; the rest wait for the
  next night. A first run against a large backlog therefore never holds locks for long.
- Each rule writes one log line, with counts only:
  `{"event":"retention_sweep","rule":"notifications","deleted":1234,"capped":false,"dryRun":false}`.
  `capped: true` means the cap was reached and more is left. Search Railway logs (worker service)
  for `retention_sweep`.

## Changing a window

1. Edit `days` for the rule in `backend/config/retention.yml`, in a pull request.
   - Each rule's `after` must stay as it is.
   - Every rule in `Retention::RULES` must be listed.
   - Days must be a positive whole number. `Retention.config` refuses anything else, and
     `test/services/retention_test.rb` fails.
2. Before merging a shorter window, run a dry run against production (below) to see how much it
   would delete.
3. To add a new kind of record: add the rule to `Retention::RULES` (`app/services/retention.rb`)
   and to the file, with tests for its boundary.

## Before the first real run, and before shortening a window (rule 7)

The first nightly run after deploy deletes the whole backlog past each window, up to 50,000 rows
per rule per night. Shortening a window does the same. So:

1. **Dry run first** on the worker service: `bin/rails retention:sweep`. Note each rule's count.
   A count of 50,000 means the cap was hit and more nights will follow.
2. **Back up.** Run the GitHub backup workflow by hand (Actions → Database backup → Run workflow)
   and wait for it to go green. A green run has been restored and checked. Or run
   `bin/rails "backup:dump[...]"` (docs/ops/backups.md). Note the run id or file name next to the
   dry-run counts.
3. Only then let the nightly job run, or run `DRY_RUN=0 bin/rails retention:sweep`. Check the
   `retention_sweep` log lines against the dry-run counts.

**Rollback** (rows deleted by mistake or too early):

1. Make the job stop deleting more. Put the rule's `days` back in `config/retention.yml` and deploy.
   To stop everything at once, remove the `retention_sweep` cron entry.
2. Restore the backup from step 2 into a scratch database (`scripts/db/restore-verify.sh`, or
   `backup:verify` with `SCRATCH_DATABASE_URL`, keeping the scratch database).
3. Copy the deleted rows back. For each affected table, `pg_dump --data-only --table=<table>` from
   the scratch database, filtered to the deleted range, then load it into production with
   `ON CONFLICT DO NOTHING`. For example, copy the scratch `notifications` rows with
   `read_at < <cutoff of that night>` into a staging table, then
   `INSERT INTO notifications SELECT * FROM staging ON CONFLICT (id) DO NOTHING`.
4. Screenshots: the blob rows come back that way, but the files were deleted from storage. They
   can only be recovered from a storage-side backup, if one exists. Treat screenshot deletion as final.

## Dry run and manual runs

On the worker service (Railway → `musilynk-worker` → a one-off command, or `railway run`):

```bash
bin/rails retention:sweep                         # dry run: what each rule would delete now (the default)
ONLY=notifications bin/rails retention:sweep      # one rule
DRY_RUN=0 bin/rails retention:sweep               # really delete (same as the nightly job)
```

The dry run counts up to the same per-run cap and deletes nothing.

## Environment variables

None.
