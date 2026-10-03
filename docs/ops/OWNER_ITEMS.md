# Owner checklist

Things only the account owner can do, with the exact dashboard steps. Variable **names** only,
never values; keep values in the password manager. Tick each item off in the PR that
closes it, or in this file.

Checked on 2026-10-03: item 6 is already done; the rest are open.

| # | Item | Status |
| --- | --- | --- |
| 1 | Web push: VAPID keys on Railway | open (feature is off and hidden until set) |
| 2 | Brevo: SPF, DKIM, DMARC on the sending domain | verified 2026-09-27; re-check after any DNS change |
| 3 | Grievance officer in `backend/config/legal.yml` | open (placeholders shown on the Privacy page) |
| 4 | Railway volume backups for Postgres | open (none configured) |
| 5 | R2 public domain and `UPLOADS_PUBLIC_BASE_URL` | open |
| 6 | `VITE_PUBLIC_API_BASE=/api` on the Vercel `musilynk` project | **set** (Production environment) |
| 7 | Region move to Singapore | open; planned, not urgent |

---

## 1. Web push: VAPID keys

Push alerts (urgent requests, replies, new messages, bookings) are off until three variables are
set on **both** Railway services. Background: `docs/ops/web-push.md`.

1. On your own machine, once: `npx web-push generate-vapid-keys`. It prints a public key and a
   private key. Do not paste them into chat, tickets or a commit.
2. Railway → project → **musilynk-api** → **Variables** → **New Variable**, three times:
   - `VAPID_PUBLIC_KEY` = the public key
   - `VAPID_PRIVATE_KEY` = the private key
   - `VAPID_SUBJECT` = `mailto:` plus the support address (push services use it to contact you)
3. Railway → **musilynk-worker** → **Variables** → the same three names and values. The worker
   sends the pushes (`PushDeliveryJob`); the API serves the public key (`GET /api/push/config`)
   and decides whether to queue anything.
4. Both services redeploy on save. Verify: `GET /api/push/config` returns `enabled: true`; on the
   site, Account → Push notifications shows the toggle; turn it on in one browser, send yourself
   a chat message from a second account, and the push arrives.
5. Keep the same pair for the life of the product. Changing it silently breaks every existing
   browser subscription.

## 2. Brevo: SPF, DKIM, DMARC

The sender is on the `notify.alienbrains.in` subdomain (`BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`
on Railway). DNS was verified on 2026-09-27 (`DEPLOYMENT.md`, "Email sign-in codes"). Re-check
after any DNS or registrar change, and whenever Brevo shows the domain as unverified.

1. Brevo → **Senders, Domains & Dedicated IPs** → **Domains** → the domain → **Authenticate**.
   Brevo shows the records to add. Today they are:
   - **SPF**: a TXT record on the sending domain containing `include:spf.brevo.com` (one SPF
     record per name; merge with any existing `v=spf1` record, do not add a second one).
   - **DKIM**: two CNAME records, `brevo1._domainkey` and `brevo2._domainkey`, pointing at the
     Brevo hosts shown on the screen.
   - **DMARC**: a TXT record on `_dmarc.<domain>`; start with `v=DMARC1; p=none; rua=mailto:<the
     reporting address Brevo gives you>`. Move to `p=quarantine` after a month of clean reports.
2. Add the records at the DNS host for the domain (the registrar's or Cloudflare's DNS page).
   If the zone is on Cloudflare, set the CNAMEs to **DNS only** (grey cloud), not proxied.
3. Back in Brevo, click **Verify** (or **Authenticate**) on each record. Propagation can take up
   to an hour.
4. Brevo → **Senders** → the sender address shows **Verified**.
5. Verify end to end: request a sign-in code to a Gmail address and open "Show original": SPF,
   DKIM and DMARC all `PASS`. Check https://status.brevo.com if nothing arrives.

## 3. Grievance officer

The DPDP Act, 2023 requires a named grievance officer on the Privacy Policy page. The page reads
`backend/config/legal.yml` → `grievance_officer` (`name`, `email`, `address`), which still holds
`[NAME]`, `[EMAIL]`, `[ADDRESS]`. Same file as the business details used on invoices
(`docs/ops/billing-invoices.md`).

1. Decide who it is (a director or an employee) and which address and mailbox they will answer
   from. The mailbox must be read.
2. Edit the three values under `grievance_officer:` in `backend/config/legal.yml`. Keep the
   quotes. Nothing else in the file needs to change.
3. Open a PR to `production` with the one-file change ("legal: name the grievance officer"). CI
   runs; `backend/test/integration/admin_funnel_and_legal_test.rb` covers the endpoint's shape.
4. After the deploy, open `/privacy` on the public site and check the name, email and address
   appear in the grievance section. Keep the mailbox monitored; the Act expects a response
   within a fixed period.

## 4. Railway volume backups

Railway reports **no backups and no schedule** on the Postgres volume (checked read-only on
2026-10-03, PR #181). The nightly GitHub workflow is the restore-tested backup; Railway's own
snapshots are a second, faster line.

1. Railway → project → **Postgres** service → **Volume** (or **Data** → the volume) → **Backups**.
2. If your plan shows a **Backup schedule** option, enable **Daily** and keep the default
   retention (or the longest the plan allows). If the option is missing or greyed out, the plan
   does not include it: either upgrade the plan or leave it and rely on the GitHub workflow plus
   the weekly in-app copy (`BackupToR2Job`, PR #181, needs `BACKUP_BUCKET` and
   `BACKUP_PASSPHRASE` on the worker).
3. Trigger one backup by hand from the same screen and wait until it shows as complete.
4. Write the restore path down next to the schedule: Railway restores a volume backup into a
   **new** volume/service; afterwards `DATABASE_URL` on `musilynk-api` and `musilynk-worker` must
   be repointed (runbook: `docs/ops/backups.md` once #181 merges; `docs/engineering/RUNBOOK.md`
   section 4 today).
5. Check the **Database backup** GitHub workflow is still green every night (Actions tab); a
   failure opens a `backup-failure` issue.

## 5. R2 public domain and `UPLOADS_PUBLIC_BASE_URL`

Today uploads are read from the bucket's own public origin (`AWS_PUBLIC_BASE_URL`). A custom
domain on Cloudflare puts the edge cache, TLS and WAF in front of every photo and audio file.
Full steps with the cache rule and the rollback: `docs/ops/uploads.md`.

1. Cloudflare → **R2 Object Storage** → the uploads bucket → **Settings** → **Public access** →
   **Custom Domains** → **Connect Domain** → enter `media.<your zone>` (the zone must already be
   on Cloudflare) → **Continue** → accept the proposed CNAME → wait for **Active**.
2. Cloudflare → the zone → **Caching** → **Cache Rules** → **Create rule**: hostname equals
   `media.<your zone>` → Eligible for cache, Edge TTL **1 month** (object keys contain a UUID, so
   files are immutable).
3. Bucket → **Settings** → **CORS policy**: keep the existing policy (the browser uploads with
   PUT from the public site origin).
4. Railway → **musilynk-api** → **Variables** → add `UPLOADS_PUBLIC_BASE_URL` =
   `https://media.<your zone>` (https is required in production). Leave `AWS_PUBLIC_BASE_URL` in
   place. Redeploy.
5. Verify: `GET /api/admin/health` → `checks.storage.ok: true`, no `problems`. Upload a photo on
   `/jobseeker/library`; its URL starts with the new origin; `curl -sI <url>` shows
   `cf-cache-status`. Old URLs keep working while the previous origin stays connected.

## 6. `VITE_PUBLIC_API_BASE=/api` on Vercel (done)

Read by name from the Vercel API on 2026-10-03: the `musilynk` project has
`VITE_PUBLIC_API_BASE` in the **Production** environment, alongside `VITE_API_URL`,
`VITE_SENTRY_DSN` and `VITE_SENTRY_ENVIRONMENT`. The `musilynk-admin` project does not have it
and does not need it (the admin site makes no edge-cached public reads).

Two things still worth confirming once:

1. `VITE_*` values are read at **build** time. Vercel → `musilynk` → **Deployments**: the current
   Production deployment must be newer than the moment the variable was added. If not,
   **Redeploy** it.
2. On the live landing page, the Network tab shows `/api/public/stats`, `/api/public/talent` and
   the Stage posts call on `musilynk.vercel.app` (same origin) with an `x-vercel-cache` header,
   not on the Railway host. `tests/e2e/edge-cache.spec.ts` checks the same against a live URL.

## 7. Region move to Singapore

Both Railway services run in Railway's default US West region today (the Postgres volume reports
`sfo`). Users are in India; Singapore (`asia-southeast1`, "Southeast Asia") cuts the round trip
by roughly 150 ms per API call. Vercel's edge is already global, so only Railway moves. Plan an
evening window; writes stop for about 15 minutes.

Before the window:

1. Merge PR #181 (`bin/rails backup:dump` / `backup:verify`, and `pg_dump`/`pg_restore` 18 in the
   image). Read `docs/ops/backups.md`, "Restore to Railway in 10 steps"; this is the same
   procedure with a new database as the target.
2. Install Postgres 18 client tools on your machine (`pg_restore --version` ≥ 18).
3. Railway → project → **New** → **Database** → **PostgreSQL**. Before deploying it, open its
   **Settings** → **Region** and pick **Southeast Asia (Singapore)** (`asia-southeast1`). Keep
   the same Postgres major (18). Turn on **Public Networking** (TCP proxy) for the migration.
   Note its `DATABASE_URL` (private) and `DATABASE_PUBLIC_URL` variable names; do not copy
   values anywhere but your shell.
4. Dry run, from the same local checkout as step 6 below: `SCRATCH_DATABASE_URL=<new DB public
   URL> bin/rails "backup:verify[<latest dump>]"` restores the latest nightly dump into the new
   database and compares the ten biggest tables. Fix anything that does not match before the
   window.

In the window:

5. **Stop writes.** Railway → **musilynk-worker** → **Settings** → scale to 0 replicas, then the
   same for **musilynk-api**. The site shows the API-unavailable screen.
6. **Dump.** The `backup:*` tasks connect through the app's own `DATABASE_URL`, so run them from
   a local checkout of `production` in `backend/` with `RAILS_ENV=production`, `SECRET_KEY_BASE`
   (any value) and `DATABASE_URL` set to the **old** database's public URL, exported in the
   shell and never echoed: `bin/rails "backup:dump[final.dump]"`. The manifest beside the dump
   holds the row counts you will check against.
7. **Restore into the new database.** `SCRATCH_DATABASE_URL=<new DB public URL> bin/rails
   "backup:verify[final.dump]"`. In production mode it restores into the database you name and
   prints the row-count table; every row must say `yes`.
8. **Repoint.** Railway → **musilynk-api** → **Variables** → `DATABASE_URL` → replace the
   reference to the old Postgres with a reference to the new service's `DATABASE_URL`. Do the
   same on **musilynk-worker**. If `REDIS_URL` or `DATABASE_PUBLIC_URL` is referenced anywhere,
   repoint those too.
9. **Move the services.** **musilynk-api** → **Settings** → **Region** → Southeast Asia
   (Singapore); scale back to 1 replica. Wait for `/api/readiness` to return 200 and
   `/api/health` to show the expected commit. Then the same for **musilynk-worker**; its
   deploy log should end with `good_job start` and stay there.
10. **Check.** Sign in as admin; `/admin/tester` is green; open a profile with uploads; send a
    chat message between two accounts; post a test urgent request and delete it. Compare
    `select count(*) from users` on the new database with the manifest from step 6.

After the window:

11. GitHub → **Settings** → **Secrets and variables** → **Actions** → update
    `PRODUCTION_DATABASE_URL` to the new database's public URL so the nightly backup follows it;
    run **Database backup** once by hand and confirm it is green.
12. Turn off **Public Networking** on the new Postgres if you enabled it only for the move.
13. Keep the old Postgres service, scaled down and untouched, for seven days. Then delete it
    (and its volume) from Railway.
14. Measure: `npm run perf:measure -- --base https://musilynk.vercel.app --runs 3` before and
    after, and the API's `/api/health` latency from an Indian connection. Record both numbers
    in `docs/PERFORMANCE.md`.

Rollback at any point before step 13: scale both services to 0, point `DATABASE_URL` back at the
old Postgres, set the region back, scale up. No data is lost because writes were stopped at step 5.
