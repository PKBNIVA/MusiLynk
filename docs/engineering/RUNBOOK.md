# MusiLynk incident runbook

What to do when something breaks in production. Every step uses something the code or
[DEPLOYMENT.md](../../DEPLOYMENT.md) actually provides. Steps marked **[owner]** need the
owner's Railway, Vercel, GitHub, Razorpay or Brevo account; nobody else can do them.

| Thing | Where |
| --- | --- |
| Web app | https://musilynk.vercel.app (Vercel project, branch `production`) |
| API | https://musilynk-api-production.up.railway.app/api (Railway service from `backend/Dockerfile`) |
| Database | Railway PostgreSQL (`DATABASE_URL` on the API service; `DATABASE_PUBLIC_URL` on the Postgres service for access from outside Railway) |
| Background jobs | GoodJob inside the API process (`GOOD_JOB_EXECUTION_MODE=async`), cron in `backend/config/initializers/good_job.rb` |
| Backups | GitHub Actions → **Database backup** (`.github/workflows/db-backup.yml`), artifacts kept 30 days |
| Errors | Sentry projects `verse-api` / `verse-web`, once the DSNs are set (DEPLOYMENT.md "Error alerting and uptime") |
| Provider status pages | https://www.vercel-status.com · https://status.railway.com · https://status.razorpay.com · https://status.brevo.com |

Targets: **RPO 24 hours** (one nightly backup; anything written since the last green run can
be lost) and **RTO 1 hour** (from deciding to restore to the API serving the restored
database). Improve the RPO with Railway's paid backups or point-in-time recovery.

---

## 1. Site down

### 1.1 Find which layer is broken (2 minutes)

Run these from any machine:

```bash
curl -sS -o /dev/null -w "web %{http_code}\n" https://musilynk.vercel.app/
curl -sS -w "\nlive %{http_code}\n"      https://musilynk-api-production.up.railway.app/api/live
curl -sS -w "\nreadiness %{http_code}\n" https://musilynk-api-production.up.railway.app/api/readiness
```

| Result | Meaning | Go to |
| --- | --- | --- |
| web not 200 | Vercel is not serving the SPA | 1.2 |
| `live` fails or times out | The Rails process is down or not deployed | 1.3 |
| `live` 200, `readiness` 503 `NOT_READY` | Rails is up but a required dependency or setting is missing: the database, GoodJob tables, `FRONTEND_URL`, `ALLOWED_ORIGINS`, `ADMIN_PASSWORD` (14+ chars) or `SEED_DEMO_DATA` left `true` | 1.4 |
| all three 200, but pages show errors | Frontend and API disagree (CORS, wrong `VITE_API_URL`, a bad release) | 1.5 |

`/api/live` and `/api/health` answer from the process alone (no database query) and include
`release`, the first 12 characters of the deployed commit. `/api/readiness` runs
`ReadinessChecks` (`backend/app/services/readiness_checks.rb`): a `SELECT 1` with a 2-second
statement timeout plus the configuration checks. Signed in as an admin,
`GET /api/admin/health` returns the same checks one by one (`checks.database.ok`,
`checks.backgroundJobs.ok`, …) and `/admin/tester` shows them in the browser.

### 1.2 Frontend (Vercel)

1. Check https://www.vercel-status.com.
2. **[owner]** Vercel → project → Deployments: is the latest Production deployment
   `Ready`? If the build failed, the previous deployment keeps serving; if a bad build went
   live, see 1.6.
3. A blank page with a stale-chunk error after a deploy recovers by itself (the app reloads
   once); a hard refresh confirms it.

### 1.3 API process (Railway)

1. Check https://status.railway.com.
2. **[owner]** Railway → API service → Deployments → latest → **Deploy logs**. The container
   runs `bin/rails db:prepare` and then Puma; the Railway health check is `/api/live` with a
   120-second timeout and up to 5 restarts (`railway.toml`). Common causes:
   - `KeyError: key not found: "SECRET_KEY_BASE"` or another missing variable: restore it
     under Variables (compare with `.env.example`).
   - A migration failing in `db:prepare`: roll back the code (1.6), then fix the migration.
   - `Bundler::GemNotFound` / frozen-lockfile errors: the Gemfile and `Gemfile.lock` disagree;
     roll back.
   - Out of memory / crash loop: Railway → Metrics. Redeploy; if it recurs, roll back.
3. If the service is healthy but unreachable, check Railway → Settings → Networking still
   has the public domain.

### 1.4 Database (Railway PostgreSQL)

1. **[owner]** Railway → Postgres service: is it running? Metrics → disk: a full volume
   stops writes. Increase the volume or free space before anything else.
2. Test from outside Railway with the TCP proxy URL (Postgres service → Variables →
   `DATABASE_PUBLIC_URL`):
   ```bash
   psql "$DATABASE_PUBLIC_URL" -Xc "select now(), count(*) from pg_stat_activity"
   ```
   Many connections in `idle in transaction` or near `max_connections` points at a
   connection leak; restarting the API service releases them. The API pool is Puma threads
   + GoodJob threads + 3 (`backend/config/database.yml`).
3. If the API's `DATABASE_URL` no longer resolves (service renamed or recreated), point it
   back at the Postgres service's `DATABASE_URL` and redeploy.
4. If data is lost or corrupted, go to section 4.

### 1.5 Frontend up, API calls failing

- Browser console shows CORS errors: `ALLOWED_ORIGINS` on Railway must list the exact web
  origin (`https://musilynk.vercel.app`, plus any custom domain).
- The app says the API returned a web page: `VITE_API_URL` on Vercel is missing or wrong, so
  `/api/*` is answered by the SPA. Fix the variable and **redeploy Vercel** (`VITE_*` values
  are read at build time).
- Release mismatch: compare `release` in `/api/health` with
  `<meta name="musilynk-release">` on the web app (or `window.__MUSILYNK_RELEASE__`). Running
  **Actions → MusiLynk QA Agent → Run workflow** on `production` fails if either side is not
  serving the latest commit.

### 1.6 Roll back

Database migrations must stay backward-compatible with the previous release
(DEPLOYMENT.md "Backups and rollback"), so the application can be rolled back on its own.

- **Web [owner]:** Vercel → Deployments → the last good Production deployment →
  **Promote to Production** (instant; no rebuild).
- **API [owner]:** Railway → API service → Deployments → the last good deployment →
  **Redeploy**.
- **Permanent fix:** revert the offending pull request on GitHub (`production` is
  protected, so the revert lands as its own PR). Both providers then deploy the reverted
  commit.

Afterwards run the post-deploy checks in DEPLOYMENT.md "Release gate".

---

## 2. Payments failing

Background: [SAAS_BILLING.md](SAAS_BILLING.md). The server creates Razorpay subscriptions and
orders; only signed webhooks (`POST /api/billing/webhook/razorpay`) change subscription state;
`BillingReconciliationJob` runs at :07 and :37 every hour and resolves stuck attempts.

1. **Is Razorpay configured?** As admin: `GET /api/admin/health` → `checks.payments`
   (`ok`, `provider`, `mode: "live"|"test"`). `ok: false` in production means a key is
   missing, the key mode is not allowed (a `rzp_test_` key without
   `RAZORPAY_ALLOW_TEST_MODE=true`), the webhook secret is missing, or a stray
   `RAZORPAY_SIMULATOR` variable exists. Fix on Railway; see DEPLOYMENT.md "Payments
   (Razorpay) go-live checklist". Payment creation fails closed while this is false.
2. **Is Razorpay up?** https://status.razorpay.com. Gateway errors reach the user as HTTP 502
   and, with Sentry on, as `verse-api` issues.
3. **Are webhooks arriving? [owner]** Razorpay Dashboard → Account & Settings → Webhooks →
   the MusiLynk webhook: check it is **Active**, the URL is
   `https://musilynk-api-production.up.railway.app/api/billing/webhook/razorpay`, and
   look at recent deliveries. A `401` response means `RAZORPAY_WEBHOOK_SECRET` on Railway does
   not match the dashboard secret; a `503` means the secret is not set. Razorpay retries
   failed deliveries for a limited time and can disable a webhook that keeps failing; after
   fixing the cause, re-enable it. Replayed or duplicate events are safe: they are
   de-duplicated by `X-Razorpay-Event-Id` and older events are recorded as `stale`.
4. **What did MusiLynk record?** Admin dashboard (`/admin`) → **Commerce** tab, or:
   - `GET /api/admin/billing-events` (and `/:id`): every webhook with its `processingResult`
     (`applied`, `stale`, `invalid_transition`, `subscription_not_found`, `ignored`, …; a
     duplicate delivery is acknowledged and not stored again).
   - `GET /api/admin/billing-attempts`: checkout and deposit attempts. Rows left `pending` or
     `ambiguous` for more than 30 minutes mean reconciliation is not keeping up.
   - `GET /api/admin/subscriptions` and `GET /api/admin/bookings`.
5. **Reconcile.** Admin dashboard → **Commerce** → **Reconcile** on an attempt
   (`POST /api/admin/billing-attempts/:id/reconcile`) asks Razorpay for the real state and
   applies it. Attempts with no provider id are handled by the next scheduled
   `BillingReconciliationJob` run (it looks them up by the attempt id or receipt).
6. **Customer paid but has no access.** After confirming the payment in the Razorpay
   dashboard and reconciling, if the subscription is still wrong, grant the plan manually:
   Admin dashboard → **Users** → **Grant plan** (`POST /api/admin/users/:id/grant-plan` with `planCode`
   `pro`/`studio`/`enterprise` and `days`, audited as `admin.plan.grant`). Record why.
7. **Refunds [owner]** are issued from the Razorpay dashboard; the `refund.processed`
   webhook marks the booking deposit refunded.

---

## 3. Email not delivering

Email goes through Brevo (`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`) from
`EmailDeliveryJob`, which retries connection errors and provider 5xx. Provider rejections are
logged as a JSON line with the provider's reason (never the email content).

1. **Is a provider configured?** `GET /api/auth/methods` (public): `emailDelivery: false`
   means no provider in production, so the sign-in page hides email codes and "Forgot
   password?" and falls back to password sign-in. Admin `GET /api/admin/health` →
   `checks.emailDelivery.provider`.
2. **One user cannot sign in:** Admin dashboard → **Sign-in doctor** → look up the email. It
   shows account status, recent failed logins and lockouts, outstanding sign-in codes, unused
   reset links, sessions, and a diagnosis (for example `SIGN_IN_CODE_UNDELIVERABLE`,
   `SIGN_IN_CODE_UNUSED`, `LOGIN_LOCKED`, `SESSION_CAP`). The lookup is audited.
3. **Nobody receives email:**
   - https://status.brevo.com.
   - **[owner]** Railway logs: search for `email delivery failed` and the provider rejection
     lines. `401`/`unauthorized` means the API key was revoked or mistyped; a sender error
     means `BREVO_SENDER_EMAIL` is not a verified sender.
   - **[owner]** Brevo → Transactional → Logs: was the message accepted, deferred, bounced or
     blocked? Brevo → Senders & domains: SPF, DKIM and DMARC for `notify.alienbrains.in` still
     verified?
4. **Keep people signed in meanwhile.** Password sign-in stays available while
   `PASSWORD_LOGIN_ENABLED` is `true` (the default). If it was set to `false`, set it back to
   `true` on Railway at once: with email broken and passwords disabled, nobody can sign in
   (DEPLOYMENT.md "Email sign-in codes and `PASSWORD_LOGIN_ENABLED`").
5. After fixing, send yourself a sign-in code and a password reset and confirm both arrive in
   an inbox, not only that Brevo accepted them.

---

## 4. Restore from backup

Use this when production data is lost or corrupted. Never restore over the live database;
restore into a new one, verify it, then switch.

**Before you start:** the `BACKUP_PASSPHRASE` from the password manager (without it the
backups cannot be decrypted), `gpg`, and a PostgreSQL client whose major version is at least
the server's (`psql "$DATABASE_PUBLIC_URL" -XAtc "show server_version"`).

1. **Stop further damage (5 min) [owner].** If bad writes are still happening, roll back the
   application (1.6). Note the time the problem started: the backup to use is the last green
   run *before* it.
2. **Pick the backup (5 min).** GitHub → Actions → **Database backup**. Choose the newest
   green run before the incident. A green run means that dump was already restored and
   checked by `scripts/db/restore-verify.sh`. Download its artifact `verse-db-<run id>`:
   ```bash
   gh run download <run id> --repo PKBNIVA/verse-music-platform --name verse-db-<run id> --dir restore
   ls restore   # musilynk-<stamp>.dump.gpg, .dump.sha256, .manifest.tsv
   ```
   If there is no green run in the last 30 days, there is no backup to restore; stop and
   escalate.
3. **Create the target database (10 min) [owner].** Railway → project → New → Database →
   PostgreSQL, same major version as production. Turn on its public networking (TCP proxy)
   and copy its `DATABASE_PUBLIC_URL`.
4. **Restore and verify (10–20 min).**
   ```bash
   SCRATCH_DATABASE_URL='<new database public URL>' BACKUP_PASSPHRASE='<passphrase>' \
     scripts/db/restore-verify.sh restore/musilynk-<stamp>.dump.gpg
   ```
   It decrypts, checks the SHA-256, runs `pg_restore --clean --exit-on-error`, then checks
   every table in the manifest. It exits non-zero if any table is missing; row-count
   differences are warnings (writes during the original dump). The script refuses to run if
   `SCRATCH_DATABASE_URL` equals `DATABASE_URL`; still, double-check the URL is the **new**
   database. The last line prints the latest migration version; it must match
   `backend/db/schema.rb` for the deployed release (if it is older, `db:prepare` will migrate
   it on boot).
5. **Switch (5 min) [owner].** Railway → API service → Variables → set `DATABASE_URL` to the
   new Postgres service's private `DATABASE_URL`. Railway redeploys; `db:prepare` runs any
   pending migrations. Keep the old database untouched until the incident is closed.
6. **Verify (10 min).** `/api/readiness` is 200; sign in as admin; `/admin/tester` is green;
   spot-check recent users, jobs and bookings.
7. **Recover the gap.** Everything after the backup's timestamp is gone. Then:
   - Payments: open `/api/admin/billing-attempts` and the Razorpay dashboard for the lost
     window; reconcile attempts and re-grant plans for payments Razorpay has but MusiLynk lost
     (section 2).
   - Sessions created after the backup no longer exist; those users simply sign in again.
   - Uploads in R2/S3 made after the backup are orphans; the daily `upload_sweep` removes
     untracked `uploads/` objects.
   - Tell affected users what was lost and when.
8. **Afterwards.** Update `PRODUCTION_DATABASE_URL` (GitHub → Settings → Secrets) to the new
   database's `DATABASE_PUBLIC_URL` so nightly backups follow it, and run the backup workflow
   once by hand. Delete the old database only when you are sure it is no longer needed.

Rehearse this at least once a quarter against a throwaway Railway database; step 4 alone is
what every nightly run already proves.

---

## 5. Security incident

Examples: leaked credentials, a compromised admin account, suspicious admin activity in the
audit log, a secret committed to the repository.

### 5.1 Contain

- **One account:** Admin dashboard → **Users** → set status to `suspended` (every request with that
  account's token then gets `403 ACCOUNT_INACTIVE`), then Sign-in doctor → **Revoke sessions**
  (`POST /api/admin/users/:id/revoke-sessions`, audited; it cannot revoke your own).
- **Everyone (for example after a token leak):** delete every session; all users must sign in
  again. **[owner]**
  ```bash
  psql "$DATABASE_PUBLIC_URL" -Xc "delete from sessions"
  ```
  Session tokens are stored only as SHA-256 digests, so rotating `SECRET_KEY_BASE` does
  **not** sign anyone out; deleting the rows does.
- **Investigate:** Admin dashboard → **Audit** (`GET /api/admin/audit`, latest 300) lists sensitive actions (`admin.*`, `auth.*`,
  billing, moderation). Railway logs have request logs; Sentry (if on) has errors by user id.

### 5.2 Rotate secrets

Rotate what may have been exposed, starting with the most powerful. All live in Railway →
API service → Variables unless noted; Railway redeploys on change.

| Secret | Where to rotate | Side effects |
| --- | --- | --- |
| Railway Postgres password | **[owner]** Railway → Postgres service (regenerate credentials) | API picks up the new `DATABASE_URL` reference on redeploy; update the `PRODUCTION_DATABASE_URL` GitHub secret for backups |
| `SECRET_KEY_BASE` | `openssl rand -hex 64` | Invalidates outstanding sign-in codes, email-job links and unsubscribe links; sessions survive (delete them separately) |
| Admin password | **[owner]** set the new `ADMIN_PASSWORD` (14+ chars) on Railway, then run `bin/rails db:seed` in the API service's shell (Railway CLI `railway ssh`); or use "Forgot password?" once email works | Seeds apply `ADMIN_PASSWORD` to the `ADMIN_EMAIL` account; changing the variable alone does not change the password |
| `RAZORPAY_KEY_SECRET` | **[owner]** Razorpay → API Keys → regenerate | Checkout fails until Railway has the new value |
| `RAZORPAY_WEBHOOK_SECRET` | **[owner]** Razorpay → Webhooks → edit secret, then Railway | Webhooks get 401 in between; reconcile afterwards (section 2) |
| `BREVO_API_KEY` | **[owner]** Brevo → SMTP & API → API keys: create new, delete old | Email fails in between; password sign-in still works |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | **[owner]** Cloudflare R2 → Manage API tokens | Uploads fail in between |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` | **[owner]** Sentry → Client Keys: revoke and create | Redeploy Vercel for the web DSN |
| `BACKUP_PASSPHRASE` | **[owner]** GitHub → Settings → Secrets | New backups use the new passphrase; keep the old one until the old artifacts expire (30 days) |
| `PRODUCTION_DATABASE_URL` | **[owner]** GitHub → Settings → Secrets | After any database password change |
| GitHub, Railway, Vercel account tokens | **[owner]** each provider's account settings | Revoke personal and CI tokens that may be exposed; enable 2FA |

A secret committed to git stays in history: rotate it; rewriting history does not un-leak it.

### 5.3 Recover and record

Un-suspend accounts that were only contained, confirm `/admin/tester` is green, and write
down what happened, when, what was exposed and what was rotated. If personal data was exposed,
the owner decides on user and regulator notification.
