# Operations runbooks

Five situations, each with symptoms, where to look, the fix and how to prove it is fixed.
Steps marked **[owner]** need the owner's Railway, Vercel, GitHub, Razorpay, Brevo or Cloudflare
account. The older incident runbook (site down, payments, email, restore from backup, security
incident) is [../engineering/RUNBOOK.md](../engineering/RUNBOOK.md); the system map is
[../engineering/ARCHITECTURE.md](../engineering/ARCHITECTURE.md).

Quick checks that every runbook uses:

```bash
curl -sS https://musilynk-api-production.up.railway.app/api/health      # release = deployed commit
curl -sS https://musilynk-api-production.up.railway.app/api/readiness   # 200, or 503 with the failing check
```

Signed in as admin, `GET /api/admin/health` lists every check with detail
(`checks.database`, `checks.backgroundJobs`, `checks.storage`, `checks.payments`,
`checks.emailDelivery`); `/admin/tester` on the admin site shows the same in the browser.
Railway logs: Railway → project → service → **Logs**. Sentry: project `verse-api` for the
backend, `verse-web` for the browser.

---

## 1. Deploy skipped: Railway did not pick up the merge

Railway deploys `musilynk-api` and `musilynk-worker` only after the five required GitHub checks
(`frontend`, `rails`, `security`, `integrated-journeys`, `local-experience`) pass **on the merge
commit on `production`**. A PR can be green and the merge commit can still fail or never finish,
so the frontend goes live on Vercel while the API stays on the previous release.

**Symptoms**

- `/api/health` returns a `release` that is not the first 12 characters of
  `git rev-parse origin/production`.
- Vercel shows the new deployment `Ready`, but a new API route answers 404 or a new column is
  missing, and the browser reports a release mismatch (`<meta name="musilynk-release">` versus
  the API's `release`).
- Railway → service → Deployments shows no deployment for the merge commit, or one marked
  **Skipped**.
- The scheduled QA run (Actions → **MusiLynk QA Agent** → `live-synthetic`) fails on the release
  check.

**Where to look**

1. GitHub → the repository → **Actions** → filter by branch `production`. Find the run for the
   merge commit. Each of the five checks is red, green or still running.
2. **[owner]** Railway → service → **Deployments**: the latest entry, its commit and its status.
3. **[owner]** Railway → service → **Settings** → the source section: the "wait for CI" option
   that holds a deploy until GitHub check suites pass must be on for both services.

**Fix**

- **A check failed on the merge commit.** Open the failed job's log. Usual causes: two PRs merged
  close together that passed alone but not combined (a bundle budget, a query budget, a schema
  conflict), or a test that depends on the date. Fix it in a new PR to `production`; never
  force-push or re-run the deploy around a red check. When the fix merges green, Railway deploys
  that commit, and it includes the earlier one.
- **A check is stuck or was cancelled.** Actions → the run → **Re-run failed jobs**. Railway
  deploys when the suite finishes green.
- **All five are green and Railway still did nothing.** **[owner]** Railway → service →
  Deployments → the latest deployment → **Redeploy**, or use the service's "deploy latest
  commit" action. If the deployment exists but is `Skipped`, the wait-for-CI setting was
  satisfied too late; redeploying is safe because the pre-deploy step (`bin/rails db:prepare
  && bin/rails sitemap:warm`) runs again and is idempotent.
- **The frontend is ahead and breaking users.** **[owner]** Vercel → Deployments → the previous
  Production deployment → **Promote to Production** until the API catches up. Instant, no build.

**Verification**

- `/api/health` `release` equals the merge commit's first 12 characters; `/api/readiness` is 200.
- Both Railway services show the same commit under Deployments (the worker has no health check,
  so read its Deploy logs: `good_job start` should be the last line and stay).
- Actions → **MusiLynk QA Agent** → **Run workflow** on `production` passes the release check.

---

## 2. Postgres disk or connections exhausted

One database serves the API, the worker, the job queue and Solid Cache. A full volume stops
writes; running out of connections makes requests wait for a pool slot and then fail.

**Symptoms**

- Disk: `/api/readiness` 503 with `checks.database.ok: false`; Sentry `verse-api` issues with
  `PG::DiskFull` or "could not extend file"; writes fail while reads work; Railway → Postgres →
  Metrics shows the volume near its limit (500 MB today).
- Connections: `ActiveRecord::ConnectionTimeoutError` ("could not obtain a connection from the
  pool within 5 seconds") in the API logs; `PG::ConnectionBad: FATAL: too many connections` or
  `remaining connection slots are reserved` on boot; requests slow then 500; jobs stop being
  picked up while `checks.backgroundJobs` reports the worker as missing.
- Both: `ActiveRecord::QueryCanceled` from the 15 s web statement timeout as everything queues
  behind locks.

**Where to look**

1. **[owner]** Railway → Postgres service → **Metrics**: disk, memory, connection count.
2. From outside Railway with the TCP proxy URL (Postgres service → Variables →
   `DATABASE_PUBLIC_URL`; export it, never paste it anywhere):
   ```bash
   psql "$DATABASE_PUBLIC_URL" -Xc "select state, count(*) from pg_stat_activity group by 1 order by 2 desc"
   psql "$DATABASE_PUBLIC_URL" -Xc "show max_connections"
   psql "$DATABASE_PUBLIC_URL" -Xc "select pg_size_pretty(pg_database_size(current_database()))"
   psql "$DATABASE_PUBLIC_URL" -Xc "select relname, pg_size_pretty(pg_total_relation_size(oid)) from pg_class where relkind='r' order by pg_total_relation_size(oid) desc limit 15"
   ```
3. Railway → `musilynk-api` and `musilynk-worker` → Logs for the error class; Sentry `verse-api`
   for the first occurrence time.
4. Pool arithmetic (`backend/config/database.yml`): each process opens up to
   `RAILS_MAX_THREADS` (default 5) + the GoodJob thread total from `config/job_queues.yml` (5
   today) + 3 connections. Multiply by the number of API replicas plus the worker, add `psql`
   sessions and the nightly backup, and compare with `max_connections`.

**Fix: disk**

1. **[owner]** Railway → Postgres → the volume → **Grow** (or move to a larger plan). Writes
   resume at once. Do this first; everything below is cleanup.
2. Find what grew (query 4 above). The usual suspects are `good_jobs` and `good_job_executions`
   (finished jobs), `notifications`, `product_events`, `sessions`, `solid_cache_entries`.
3. Run the retention sweep once PR #182 is merged: in the API service shell (Railway →
   service → the shell/SSH action), `bin/rails retention:sweep` shows what would go;
   `DRY_RUN=0 bin/rails retention:sweep` deletes in batches. `ONLY=good_jobs` limits it to one
   rule. Before #182, GoodJob's own cleanup removes finished jobs on its schedule; nothing else
   is deleted automatically.
4. Reclaim space: `psql "$DATABASE_PUBLIC_URL" -Xc "vacuum (verbose, analyze)"`. A plain `VACUUM`
   does not shrink files; it frees space for reuse. Only `VACUUM FULL <table>` returns space to
   the volume, and it locks the table, so run it off-peak and one table at a time.
5. If uploads are on disk (`PERSISTENT_UPLOADS=true` with a volume), that volume is separate
   from Postgres; move uploads to R2 (runbook 5) instead of growing it.

**Fix: connections**

1. **[owner]** Restart `musilynk-api` (Railway → service → Deployments → latest → **Restart**).
   Leaked or `idle in transaction` connections close with the process. Restart the worker only if
   it is the one holding them (its `application_name` or `query` in `pg_stat_activity` shows
   GoodJob).
2. Kill stragglers that survive a restart (another client, a stuck `psql`, the backup job):
   ```bash
   psql "$DATABASE_PUBLIC_URL" -Xc "select pg_terminate_backend(pid) from pg_stat_activity where state = 'idle in transaction' and state_change < now() - interval '5 minutes'"
   ```
3. If the arithmetic exceeds `max_connections`: lower `RAILS_MAX_THREADS` or the API replica
   count, or lower a pool's `threads` in `config/job_queues.yml` (one config file; the database
   pool follows it). Raising `max_connections` on Railway Postgres is a **[owner]** change on the
   Postgres service's settings or a larger plan; each connection costs memory.
4. A new code path that opens connections outside the pool (a thread, a `Thread.new` with
   ActiveRecord, a manual `PG.connect`) is a bug: find it in the Sentry stack trace and fix it
   in a PR.

**Verification**

- `/api/readiness` 200; `GET /api/admin/health` → `checks.database.ok` and
  `checks.backgroundJobs.ok` true.
- `pg_stat_activity` shows a steady count well under `max_connections`, with zero
  `idle in transaction` older than a minute.
- Railway → Postgres → Metrics: disk headroom at least 30 %; set a reminder to check it monthly
  (`docs/ops/retention.md` once #182 lands says what should stay small).
- Next nightly **Database backup** run is green (it opens its own connection and reads every
  table).

---

## 3. Razorpay webhook failures

The server creates subscriptions and deposit orders; only a signed webhook delivered to
`POST /api/billing/webhook/razorpay` changes subscription state (`BillingController#razorpay_webhook`,
`backend/app/controllers/billing/billing_controller.rb`). Each event is stored once in
`billing_events` with a `processingResult`. `BillingReconciliationJob` (every hour at :07 and
:37) asks Razorpay about anything still `pending`.

**Symptoms**

- A customer paid (Razorpay dashboard shows `captured`) but the plan did not change, or a
  booking deposit stays "awaiting payment".
- Admin → **Commerce**: `billing_attempts` rows left `pending` or `ambiguous` for more than
  30 minutes; no new `billing_events` in hours although Razorpay shows deliveries.
- **[owner]** Razorpay Dashboard → Webhooks → the MusiLynk webhook shows failed deliveries, or
  Razorpay has disabled the webhook after repeated failures.
- Sentry `verse-api`: errors tagged `BillingController#razorpay_webhook`.

**Where to look**

1. **[owner]** Razorpay Dashboard → **Account & Settings** → **Webhooks** → the webhook: status
   (Active or disabled), URL
   (`https://musilynk-api-production.up.railway.app/api/billing/webhook/razorpay`), subscribed
   events, and the recent deliveries with their response codes.
2. The response code tells you the cause:
   | Code | Meaning | Where it comes from |
   | --- | --- | --- |
   | `503` "Billing webhook is not configured" | `RAZORPAY_WEBHOOK_SECRET` is unset on `musilynk-api` | the controller's first guard |
   | `401` "Invalid webhook signature" | the secret on Railway differs from the one in the Razorpay webhook | HMAC check on `X-Razorpay-Signature` |
   | `400` "Invalid webhook payload" | not JSON, or no event id | payload parse |
   | `200` with `duplicate: true` | already processed; harmless | de-duplication on the event id |
   | `200` with `ok: true` | applied, or recorded as `stale`, `invalid_transition`, `subscription_not_found`, `ignored` | the stored `processingResult` |
   | `5xx` | an exception while applying the event | Sentry has the stack trace |
   | timeout, no response | the API was down (runbook 1) or slow (runbook 2) | Railway logs |
3. What MusiLynk recorded: Admin → **Commerce**, or `GET /api/admin/billing-events` (and `/:id`),
   `GET /api/admin/billing-attempts`, `GET /api/admin/subscriptions`.
4. `GET /api/admin/health` → `checks.payments`: `ok`, `provider`, `mode` (`live` or `test`).
   `ok: false` means a key is missing, a `rzp_test_` key is used without
   `RAZORPAY_ALLOW_TEST_MODE=true`, the webhook secret is missing, or a stray
   `RAZORPAY_SIMULATOR` variable exists.

**Fix**

- **503 or 401.** **[owner]** Razorpay → the webhook → edit → copy or regenerate the secret.
  Railway → `musilynk-api` → Variables → set `RAZORPAY_WEBHOOK_SECRET` to the same value. Railway
  redeploys. Both must change together; a 401 window between the two is expected.
- **Webhook disabled by Razorpay.** Fix the cause first, then **[owner]** re-enable it in the
  Razorpay dashboard. Razorpay retries failed deliveries for a limited time only.
- **Missed events.** Admin → **Commerce** → **Reconcile** on the affected attempt
  (`POST /api/admin/billing-attempts/:id/reconcile`) fetches the real state from Razorpay and
  applies it. Attempts without a provider id are picked up by the next
  `BillingReconciliationJob` run (it looks them up by attempt id or receipt).
- **Still wrong after reconciling.** Admin → **Users** → **Grant plan**
  (`POST /api/admin/users/:id/grant-plan` with `planCode` and `days`, audited as
  `admin.plan.grant`) after confirming the payment in the Razorpay dashboard. Write down why.
- **5xx on apply.** Root-cause from Sentry, fix in a PR. Replaying the event from the Razorpay
  dashboard after the fix is safe: a duplicate is acknowledged and not stored twice; an older
  event than the subscription's current state is recorded as `stale`.
- **Refunds [owner]** are issued in the Razorpay dashboard; the `refund.processed` event marks
  the deposit refunded.

**Verification**

- **[owner]** Razorpay → the webhook → **Send test webhook** (or replay a recent event) returns
  `200`; a new `billing_events` row appears with `processingResult: applied` or `ignored`.
- `GET /api/admin/billing-attempts` shows no `pending` or `ambiguous` rows older than
  30 minutes after the next reconciliation run.
- The affected customer's `GET /api/billing/subscription` (as them) or
  `GET /api/admin/subscriptions` shows the right plan and period.

---

## 4. Brevo email outage

Every email (sign-in codes, resets, notifications, digests, invoices) goes through Brevo's HTTP
API from the worker: `EmailDeliveryJob` (codes, links, security notices) and
`NotificationEmailJob` (notifications), both on the `mailers` queue, urgent alerts on `urgent`.
Both retry connection errors and 5xx five times with increasing waits. A 4xx is logged as a
skip with the provider's reason, not retried.

**Symptoms**

- Nobody receives sign-in codes; people fall back to password sign-in or write in.
- Railway → `musilynk-worker` → Logs: `email_delivery_skipped` or `notification_email_skipped`
  lines, `Faraday::ConnectionFailed`, or `ProviderUnavailable: email provider returned 5xx`
  with retries.
- Sentry `verse-api`: `EmailDeliveryJob::ProviderUnavailable` after the fifth attempt.
- `GET /api/admin/health` → `checks.emailDelivery.ok: false` (variables missing) or
  `emailSuppressions` climbing (Brevo is rejecting addresses).
- https://status.brevo.com reports an incident.

**Where to look**

1. https://status.brevo.com.
2. **[owner]** Brevo → **Transactional** → **Logs** (or **Statistics**): accepted, deferred,
   bounced, blocked? If Brevo accepted the mail and the inbox is empty, the problem is DNS or
   reputation, not an outage.
3. **[owner]** Brevo → **Senders & domains**: is the sending domain still showing SPF, DKIM and
   DMARC as verified? Is `BREVO_SENDER_EMAIL` still a verified sender?
4. Railway → `musilynk-worker` → Logs, searching `email_delivery` and `notification_email`.
   `401`/`unauthorized` means the API key was revoked or rotated in Brevo; a sender error means
   the sender address is not verified.
5. Admin → **Sign-in doctor** for one person: outstanding codes, `SIGN_IN_CODE_UNDELIVERABLE`,
   `EMAIL_SUPPRESSED`.
6. Queue depth: Admin → **Operations** (`/admin` → Operations) shows job counts;
   `GET /api/admin/health` → `checks.backgroundJobs`.

**Fix**

- **Brevo is down.** Nothing to change. Jobs retry on their own for about an hour. Make sure
  people can still sign in: `PASSWORD_LOGIN_ENABLED` on `musilynk-api` must be `true` (the
  default). If it was set to `false`, set it back now. Tell support what to say.
- **Retries exhausted (outage longer than the retry window).** Codes and reset links expire, so
  the user simply requests a new one once Brevo is back; nothing to replay. Notification emails
  that were dropped are not resent; the in-app notification is the record of truth.
- **401 from Brevo.** **[owner]** Brevo → **SMTP & API** → **API keys** → create a new key;
  Railway → `musilynk-api` **and** `musilynk-worker` → Variables → `BREVO_API_KEY`; delete the
  old key in Brevo after the redeploy.
- **Sender rejected.** **[owner]** Brevo → Senders & domains → verify the sender, or set
  `BREVO_SENDER_EMAIL` to a verified one. Both services.
- **DNS no longer verified.** Re-add the SPF, DKIM and DMARC records Brevo shows (exact steps in
  [OWNER_ITEMS.md](OWNER_ITEMS.md), item 2). Mail flows but lands in spam until this is fixed.
- **Addresses suppressed by mistake.** Remove the address from Brevo's blocklist
  (Transactional → Contacts → Blocked) and delete its `email_suppressions` row in the API shell:
  `bin/rails runner 'EmailSuppression.where(email: "someone@example.com").delete_all'`.

**Verification**

- Request a sign-in code and a password reset for your own account; both arrive in the inbox
  (not only "accepted" in Brevo). Send yourself a chat message from a second account and
  receive the notification email.
- Railway worker logs show no new `email_delivery_skipped`, `notification_email_skipped` or
  `ProviderUnavailable` lines.
- `GET /api/admin/health` → `checks.emailDelivery.ok: true`; the Brevo bounce webhook test
  button still produces a count on `/admin/tester`.

---

## 5. R2 misconfiguration

Uploads go straight from the browser to the bucket with a presigned PUT
(`POST /api/uploads/presign`), then the API verifies the object (`POST /api/uploads/:id/complete`).
Public reads use `UPLOADS_PUBLIC_BASE_URL`, else `AWS_PUBLIC_BASE_URL`
(`backend/app/services/upload_storage.rb`). All variables live on `musilynk-api`; the worker needs
none except for `BackupToR2Job` once PR #181 lands.

**Symptoms**

- Uploads fail with `503 STORAGE_MISCONFIGURED`; `GET /api/admin/health` → `checks.storage.ok:
  false` with a `problems` list.
- Uploads fail in the browser with a CORS error against `*.r2.cloudflarestorage.com`
  (`presign` succeeded, the PUT did not).
- `complete` returns an error: the object is missing or its size/type does not match (wrong
  bucket, wrong endpoint, or a PUT that was rejected).
- Photos and audio show broken links: the public domain changed or was disconnected, or
  `UPLOADS_PUBLIC_BASE_URL` points at a host that is not in front of the bucket.
- Sentry `verse-api`: `Aws::S3::Errors::SignatureDoesNotMatch`, `InvalidAccessKeyId`,
  `NoSuchBucket`, `AccessDenied`.

**Where to look**

1. `GET /api/admin/health` → `checks.storage`. The `problems` values map to a variable:
   | Problem | Means | Variable |
   | --- | --- | --- |
   | `missing_credentials` | one of the two keys is unset | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
   | `missing_public_base_url` | custom endpoint with no read origin | `UPLOADS_PUBLIC_BASE_URL` or `AWS_PUBLIC_BASE_URL` |
   | `insecure_endpoint` | endpoint is not `https://` | `AWS_ENDPOINT_URL_S3` |
   | `insecure_public_base_url` | read origin is not `https://` | `UPLOADS_PUBLIC_BASE_URL` / `AWS_PUBLIC_BASE_URL` |
2. **[owner]** Cloudflare → **R2 Object Storage** → the bucket → **Settings**: Public access
   (custom domain `Active`? r2.dev enabled?), **CORS policy**, and **Manage API tokens** for the
   token's permissions (Object Read & Write, scoped to this bucket) and expiry.
3. Railway → `musilynk-api` → Variables (names and lengths only): `AWS_BUCKET`,
   `AWS_ENDPOINT_URL_S3` (`https://<account>.r2.cloudflarestorage.com`), `AWS_REGION` (`auto`),
   `AWS_PUBLIC_BASE_URL`, `UPLOADS_PUBLIC_BASE_URL`, `AWS_UPLOAD_METHOD` (`put` on R2).
4. The browser's Network tab on a failing upload: the PUT's status and the `access-control-*`
   response headers.
5. `curl -sI <a stored upload URL>`: 200 with `cf-cache-status` means the read domain is fine;
   404 means the object or the domain is wrong; a connection error means DNS.

**Fix**

- **A variable is missing or wrong.** **[owner]** Set it on `musilynk-api` and redeploy. Compare
  with the table in `docs/ops/uploads.md`; do not guess the endpoint, copy it from Cloudflare →
  R2 → the account's S3 API line.
- **Token revoked or expired.** **[owner]** Cloudflare → R2 → Manage API tokens → create a new
  token (Object Read & Write, this bucket); set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
  on Railway; delete the old token afterwards. Uploads fail in between.
- **CORS.** **[owner]** Bucket → Settings → CORS policy: the public site origin
  (`https://musilynk.vercel.app` and any custom domain) with `PUT`, `POST`, `GET`, `HEAD`, the
  headers the browser sends (`Content-Type`, `Content-Length`), and `ETag` exposed. The exact
  policy is in `DEPLOYMENT.md`, "Object storage — Cloudflare R2".
- **Public domain broken.** If the custom domain was disconnected, reconnect it (bucket →
  Settings → Custom Domains) or point `UPLOADS_PUBLIC_BASE_URL` at the `https://pub-<id>.r2.dev`
  origin as a stop-gap (it is rate-limited and not cached). Existing rows keep the URL they were
  issued with, so the old origin must keep serving the bucket until no profile links to it.
- **Wrong upload method.** `AWS_UPLOAD_METHOD` is `put` on R2 by default; only set `post`
  after a controlled upload succeeds with it.
- **Orphans after an incident.** The daily `UploadSweepJob` (04:43 UTC) deletes pending uploads
  older than 24 h and untracked `uploads/` objects; nothing to run by hand.

**Verification**

- `GET /api/admin/health` → `checks.storage.ok: true`, `problems: []`.
- As a musician, upload a photo on `/jobseeker/library`: the saved URL starts with the expected
  origin and the image loads. Delete the sample; the URL now 404s.
- `curl -sI` on a stored URL shows `cf-cache-status` (`MISS`, then `HIT`) when a custom domain
  is in use.
- `tests/e2e/library-upload.spec.ts` and `tests/e2e/portfolio-uploads.spec.ts` pass against a
  staging build if you changed anything in code.
