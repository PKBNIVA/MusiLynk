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
| `problem_report_screenshots` | the report was filed | 30 | The screenshot file and its blob row | The report: text, page, status, admin notes |
| `product_events` | the event happened | 180 | Analytics and funnel events (the funnel reads at most 30 days back) | Newer events |
| `erased_account_residue` | the account was erased | 30 | The erased person's analytics events, and other people's "recently viewed" entries that still carry the old name | The anonymised user row, messages already sent, billing and audit records (`AccountErasure` keeps these on purpose) |
| `good_jobs` | the job finished (succeeded or discarded) | 14 | Finished GoodJob jobs and their executions | Queued and running jobs |

Notes:

- **Erasure time** is the user row's `updated_at`. `AccountErasure` sets it when it anonymises the
  row (status `deleted`). A later edit to that row only delays this cleanup; it never brings it forward.
- **GoodJob** also runs its own periodic cleanup. `config/initializers/good_job.rb` sets that cleanup
  to the same 14 days from this file, so the two never disagree.
- **Email tokens** (password reset and verification) stay with `AuthCleanupJob`: 7 days after they
  expire or are used. Sessions and sign-in codes moved from that job to this sweep.
- **Profile-view milestone:** the "100 profile views" email counts `profile_view` events. Events
  older than 180 days no longer count, so a profile that took longer than that to reach 100 views
  may never get the email. The email still fires at most once per profile.

## Limits

- Rows go in batches of `batch_size` (1,000).
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
