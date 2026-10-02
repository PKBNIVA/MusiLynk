# MusiLynk production deployment

## Source of truth

Production is the Rails/Vite application on the GitHub `production` branch.

- Frontend: Vercel
- API and GoodJob workers: Railway
- Database: Railway PostgreSQL
- Object storage: S3-compatible storage when configured
- Payments: Razorpay when live credentials are configured
- Transactional email: Brevo when live credentials are configured

The divergent legacy Node/Render application on `main` is not a release source. Do not
connect a production provider to `main`.

## Frontend — Vercel

Configure the repository root as a Vite project:

- Production branch: `production`
- Build command: `npm run build`
- Output directory: `dist`
- `VITE_API_URL=https://musilynk-api-production.up.railway.app/api`
- `VITE_PUBLIC_URL=https://musilynk.vercel.app`

`vercel.json` provides SPA routing, immutable asset caching, and browser security headers.

### Admin site (second Vercel project from the same repository)

The admin console is its own site, built from the same code with `VITE_APP_TARGET=admin`.
`src/app/routes.tsx` picks the route table at build time, so each build contains only its own
pages: the public build has no `/admin`, `/admin/tester` or `/auth/admin` (all 404) and no admin
code, and the admin build has no public pages. `npm run check:split` builds the admin site into
`dist-admin/` and fails if either build contains the other's pages (CI runs it).

- Project settings: same as above (production branch `production`, `npm run build`, output `dist`).
- Variables: `VITE_APP_TARGET=admin` (production and preview), the same `VITE_API_URL`,
  `VITE_SENTRY_DSN` (the verse-web DSN) and `VITE_SENTRY_ENVIRONMENT=admin-production` so admin
  errors can be told apart.
- Pages: `/` sign-in (password, then the emailed 6-digit code when the second step applies),
  `/admin` console, `/admin/tester`, `/account` (the admin's email and password). Every signed-in
  page shows a warning while the admin's address cannot receive email or the second step is not
  enforced (`GET /api/admin/account`), linking to `/account`, where the address is changed by
  confirming a code sent to the new mailbox. The page title is "MusiLynk Admin" and
  `<meta name="robots" content="noindex, nofollow">` keeps it out of search results.
- The admin site's exact origin (for example `https://verse-admin-xxxx.vercel.app`) is the
  API's `ADMIN_ORIGIN` (see "Admin site and `ADMIN_ORIGIN`" below for what that locks). Its URL is
  not linked from, or contained in, the public site: an admin who signs in there is told "Admins
  sign in at the admin site." and any admin session started there is ended at once.
- Local: `VITE_APP_TARGET=admin npm run dev`. Playwright builds it into `dist-qa-admin/` and serves
  it on port 4176 for the `admin-desktop` project (`tests/e2e/admin-*.spec.ts`).
- Rollback: revert the frontend PR (the public site gets `/admin` back), and unset `ADMIN_ORIGIN`
  on Railway so the API accepts admin requests from the public site again.

## API — Railway

Configure one service from `backend/Dockerfile`:

- Production branch: `production`
- Config file: `railway.toml`
- PostgreSQL must expose `DATABASE_URL` to the Rails service.
- Migrations: `railway.toml` sets `preDeployCommand = "bin/rails db:prepare"`, which Railway
  runs once per deploy in a separate container before the new release takes traffic. If it
  fails, the deploy stops and the previous release keeps serving. The web container
  (`backend/bin/web`) also runs `db:prepare` before Puma unless
  `SKIP_DB_PREPARE_ON_BOOT=true` (see "Migrations before deploy" below).
- Railway's liveness probe is `/api/live`.
- Operational checks are `/api/health` and `/api/readiness`.

GoodJob initially runs inside the web service with
`GOOD_JOB_EXECUTION_MODE=async`, `GOOD_JOB_MAX_THREADS=2`, and
`GOOD_JOB_ENABLE_CRON=true`. Run cron on exactly one process. "Separate job worker" below
moves jobs and cron to their own service.

### Database timeouts

Every connection sets Postgres `statement_timeout` and `lock_timeout`
(`backend/config/database_session_settings.rb`, applied through `variables:` in
`database.yml`), so a runaway query or a blocked lock fails fast instead of holding a Puma
thread and a pool connection:

| Process | statement_timeout | lock_timeout | Override with |
| --- | --- | --- | --- |
| Web requests (Puma) | `15s` | `5s` | `DB_STATEMENT_TIMEOUT`, `DB_LOCK_TIMEOUT` |
| Jobs, in the worker or in-process (`async`) | `5min` | `30s` | `WORKER_DB_STATEMENT_TIMEOUT`, `WORKER_DB_LOCK_TIMEOUT` |
| `bin/rails db:*` (migrations, pre-deploy) | none | none | `DB_MIGRATION_STATEMENT_TIMEOUT`, `DB_MIGRATION_LOCK_TIMEOUT` |

Values use Postgres duration syntax (`500ms`, `15s`, `5min`); `0` means no limit; anything
else is ignored. `ApplicationJob` switches its connection to the job limits for the length of
each job and restores the previous values afterwards (a connection that cannot be restored is
dropped from the pool), so in-process jobs never run under the 15s web limit. GoodJob's LISTEN connection waits outside any statement, so the limits never
cut it off. A timed-out query raises `ActiveRecord::QueryCanceled` (reported to Sentry).

### Migrations before deploy

Today migrations run twice per deploy: in the pre-deploy step and again on web boot (a
no-op the second time). To run them only before deploy:

1. Confirm a deploy's logs show the pre-deploy step running `bin/rails db:prepare`
   successfully (Railway → web service → Deployments → the deploy → "Pre-deploy" logs).
   If the step is missing, check service Settings → Deploy → "Pre-deploy command" shows
   `bin/rails db:prepare` (it comes from `railway.toml`; set it there by hand if not).
2. Set `SKIP_DB_PREPARE_ON_BOOT=true` on the web service and redeploy.
3. Check `/api/readiness` returns 200 and the boot logs no longer show `db:prepare`.

Roll back: delete `SKIP_DB_PREPARE_ON_BOOT` (or set it to `false`) and redeploy; boot
migrations resume. Migrations must stay backward-compatible with the previous release,
because the old release keeps serving while the pre-deploy step migrates.

### Separate job worker

Prerequisite: uploads on R2 (`AWS_BUCKET` set, see "Object storage"). Disk uploads live on
the web service's volume, which a second service cannot mount; `bin/worker` refuses to start
in production without `AWS_BUCKET` (override: `WORKER_ALLOW_DISK_UPLOADS=true`, which means
upload cleanup jobs delete rows but leave their files on the web volume).

1. **Create the service.** Railway project → New → GitHub Repo → this repository, name it
   e.g. `musilynk-worker`. In its Settings: Source branch `production`; Config-as-code →
   Railway config file path `railway.worker.toml`. That file builds the same Dockerfile and
   starts `gosu rails bin/worker`, with no healthcheck and no public domain (do not generate
   one). `bin/worker` waits up to `WORKER_MIGRATION_WAIT_SECONDS` (default 600) for the web
   service's pre-deploy migrations, then runs `bin/good_job start`.
2. **Worker variables.** Jobs send email, talk to Razorpay and R2 and report to Sentry, so
   the worker needs the same configuration as the web service: web service → Variables →
   Raw Editor → copy everything, paste into the worker's Raw Editor (or use Railway shared
   variables so both stay in sync). Then set on the worker:
   - `GOOD_JOB_ENABLE_CRON=true`
   - `GOOD_JOB_MAX_THREADS=5` (the database pool follows it automatically)
   - `GOOD_JOB_SHUTDOWN_TIMEOUT=25` (finish in-flight jobs within `drainingSeconds = 30`)
   `GOOD_JOB_EXECUTION_MODE` is ignored by `good_job start`, so a copied `async` is harmless.
3. **Deploy and check it is alive.** The worker's logs show
   `GoodJob ... started scheduler with queues=* max_threads=5` and
   `Notifier subscribed with LISTEN`. Until step 4 both services run jobs and cron; that is
   safe (a job is locked by one process, and GoodJob's unique `cron_key`/`cron_at` index
   enqueues each cron tick once), just do step 4 soon after.
4. **Switch the web service off jobs.** On the web service set
   `GOOD_JOB_EXECUTION_MODE=external` and `GOOD_JOB_ENABLE_CRON=false`, then redeploy.
   From now on `/api/readiness` (and `/api/admin/health` → `checks.backgroundJobs`) returns
   not-ready if no worker has checked in within GoodJob's 5-minute heartbeat window;
   `activeWorkers` and `lastWorkerHeartbeatAt` say what it saw. Point an uptime monitor at
   `/api/readiness` to be alerted. Railway's own healthcheck stays on `/api/live`, so a dead
   worker never restarts or blocks the web service.
5. **Verify.** `/api/admin/health` → `checks.backgroundJobs` shows `ok: true` and
   `activeWorkers: 1`. Trigger an email (e.g. request a sign-in code) and confirm it arrives
   and the worker's logs show the job performed.

Roll back: set `GOOD_JOB_EXECUTION_MODE=async` and `GOOD_JOB_ENABLE_CRON=true` on the web
service (or delete both) and redeploy, then remove or pause the worker service. Do the web
change first so jobs are never left without a runner. Queued jobs stay in Postgres and are
picked up by whichever process runs next.

### Replicas

The web service must stay at **one replica** while `PERSISTENT_UPLOADS=true` and the upload
volume are in use (a Railway volume attaches to one instance). After R2 is configured and the
volume removed ("Object storage", step 8), the web service can run more replicas: set
Settings → Deploy → Replicas, and keep `RAILS_MAX_THREADS × replicas` plus the worker's pool
under the Postgres plan's connection limit. Run exactly one worker replica unless cron is
disabled on all but one.

## Required launch configuration

Set strong, provider-managed secrets. Never commit values.

- `SECRET_KEY_BASE`
- `DATABASE_URL`
- `FRONTEND_URL`, `FRONTEND_HOST`, and `ALLOWED_ORIGINS`
- `API_HOST`
- `ADMIN_EMAIL` and `ADMIN_PASSWORD`
- GoodJob variables from `.env.example`

Before enabling each integration, configure and test its variables:

- Razorpay: key ID, key secret, webhook secret, and plan IDs
- Brevo: API key and verified sender

### AI provider (`AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`)

AI writing help runs on OpenAI by default (`provider: openai` in `backend/config/ai_pricing.yml`,
model `gpt-5.6-luna`). On the Railway web service (and the worker, which runs the verification
summaries and link-import drafting) set:

- `OPENAI_API_KEY`: platform.openai.com, API keys, create a project key. Blank means AI is
  reported disabled in `GET /api/ai/status` and every feature uses its deterministic fallback.
- `OPENAI_MODEL` (optional): override the model id from the yml.
- `AI_PROVIDER` (optional): `openai` or `anthropic`. `anthropic` switches back to the previous
  provider and needs `ANTHROPIC_API_KEY` instead; no deploy of code is needed, only the variable.

Set a monthly usage limit in OpenAI billing that matches the app's ₹1,500 hard cap. Admin, AI
spend shows the active provider and model. The Anthropic Message Batches queue
(`classify_portfolio_item`, launch-disabled) only submits when the provider is `anthropic`.

### Email sign-in codes and `PASSWORD_LOGIN_ENABLED`

Email sign-in codes are the primary sign-in path; password sign-in stays available as a
fallback. `PASSWORD_LOGIN_ENABLED` defaults to `true`. Set it to `false` only after a
controlled production test shows sign-in codes reaching real inboxes (Brevo acceptance
is not enough); otherwise every user is locked out. When `false`, `POST /api/auth/login`
returns 403 `PASSWORD_LOGIN_DISABLED` (admins included) while `/api/auth/otp/request`
and `/api/auth/otp/verify` keep working. Roll back by setting it to `true` again.
Without an email provider in production, `GET /api/auth/methods` reports `signInCodes: false`:
the sign-in page opens on password sign-in and hides "Email me a code" and "Forgot password?",
and `/api/auth/otp/request` answers 503 `OTP_UNAVAILABLE` (identical for every address, no code
issued). Adding `BREVO_API_KEY` switches the page back to codes on the next deploy.

Current production sender (set 2026-09-27): `BREVO_SENDER_EMAIL=no-reply@notify.alienbrains.in`,
`BREVO_SENDER_NAME=MusiLynk`. DNS verified the same day: SPF `include:spf.brevo.com`, DKIM
`brevo1`/`brevo2._domainkey` CNAMEs to Brevo, DMARC `p=none` with Brevo reporting.
`BREVO_API_KEY` is still to be added (Brevo → SMTP & API → API keys → Generate).

Codes expire after 10 minutes, are single use, allow 5 attempts, and are limited to 5
requests per email and per IP per hour. Outside production, and only when no email
provider is configured, the request response includes `debugCode` for local QA.

### Admin two-step sign-in and `ADMIN_SECOND_FACTOR`

When the second step applies, an admin who signs in with a password gets `202` from
`POST /api/auth/login` with `secondFactorRequired: true` and a 10-minute `challengeToken`, and
is emailed a 6-digit code; `POST /api/auth/second-factor {challengeToken, code}` completes
sign-in. Admins who sign in with an email code never need it (the code proves inbox control).

| `ADMIN_SECOND_FACTOR` | With email delivery | Without email delivery (production) |
| --- | --- | --- |
| `auto` (default; also any unrecognised value) | Code required | Password alone works; audited as `auth.admin_second_factor_skipped`; `/admin/tester` and the sign-in doctor warn "Admin 2-step sign-in is off because email delivery is not configured" |
| `required` | Code required | Password sign-in refused: 503 `SECOND_FACTOR_UNAVAILABLE` |
| `off` | Emergency disable: password alone, audited as `secondFactor: "disabled"`, flagged in the doctor and tester | Same |

An admin whose own address is suppressed (bounced or complained, see the Brevo webhook
below) is treated as "without email delivery" too, and the sign-in doctor says so.
Outside production the on-screen `debugCode` counts as delivery. Recommended order: add
`BREVO_API_KEY` (the second step then turns on by itself under `auto`), confirm an admin
receives the code, then set `ADMIN_SECOND_FACTOR=required` so a later email outage fails
closed instead of silently skipping the step. Use `off` only in an emergency and remove it
afterwards.

### Weekly founder report and `FOUNDER_REPORT_TO`

Every Monday 09:00 IST (03:30 UTC, GoodJob cron `founder_report`) `FounderReportJob` emails last
Monday-to-Sunday (IST) in numbers, organic accounts only, with a "Needs you" list that links to
the admin console (`ADMIN_ORIGIN`, else `FRONTEND_URL`, plus `/admin?tab=queue|verification|reports|urgent`).

- Recipients: `FOUNDER_REPORT_TO` (optional; comma-separated addresses). Unset, it goes to every
  active admin account (the `ADMIN_EMAIL` user). Needs working email delivery (Brevo or Resend).
- Needs the worker running with cron on (`GOOD_JOB_ENABLE_CRON`, default on in production).
- Preview without sending: `bin/rails "reports:founder[preview]"`; send now: `bin/rails reports:founder`.

### Problem reports ("Report a problem")

People (signed in, or signed out with an email) send problems from the account menu, the app
error screen and the landing footer to `POST /api/problem-reports`; the founder triages them in
the admin console's **Problem reports** tab and sees the count in the Monday report.

- Founder email: one email per report with a link to the admin console (never the report text or
  the screenshot). Recipients: `FOUNDER_REPORT_TO` (optional, comma-separated) if set, else
  `ADMIN_EMAIL` (the Railway variable that seeds the admin account). With neither set, or no email
  provider, nothing is sent and the report is still stored. Capped at 30 emails an hour.
- Screenshots are stored through Active Storage on the same storage as uploads (`AWS_BUCKET`, or
  `PERSISTENT_UPLOADS=true` on a volume). Without durable storage the report is kept and the
  screenshot is dropped (the dialog says so). Admins view a screenshot through a 5-minute signed
  link and each view is audit-logged (`admin.problem_report.screenshot`).
- Limits: signed in 10 an hour; signed out 3 an hour and 8 a day per IP, 3 a day per email
  address, 100 a day site-wide; screenshots are PNG/JPEG/WebP up to 4 MB (checked by file
  contents). The request body limit for this one endpoint is 5 MB.
- No new environment variables.

### Admin site and `ADMIN_ORIGIN`

The admin panel is meant to run as its own Vercel project (a second build of this repo with
`VITE_APP_TARGET=admin`) at an unpublished URL. `ADMIN_ORIGIN` is that site's exact origin
(scheme + host, no path, e.g. `https://verse-admin-xxxx.vercel.app`). While it is **unset**,
the API behaves as it always has: nothing below applies, and the public site's `/admin` keeps
working. Set it only after the admin site is deployed and reachable.

When set, per request (no restart beyond the redeploy Railway does for a variable change):

- Every `/api/admin/*` request must carry `Origin: <ADMIN_ORIGIN>`, matched exactly; a
  missing or different header answers 403 `ADMIN_ORIGIN_REQUIRED` before the token is checked.
  Scripts and monitors that call the admin API must therefore send that header.
- An admin's password sign-in (`POST /api/auth/login`) and its second step
  (`/api/auth/second-factor`) from any other origin answer 403 `ADMIN_USE_ADMIN_SITE`
  ("Admins sign in at the admin site."), audited as `auth.admin_wrong_origin`. Everyone else
  signs in exactly as before, from either site.
- Admin accounts never get or accept email-only sign-in codes (`/api/auth/otp/*`): the
  request answers like an unknown address and verify answers `OTP_INVALID`. Admins always use
  password + emailed code, on the admin site.
- CORS: the public origins (`ALLOWED_ORIGINS`) reach every route except `/api/admin/*`; the
  admin origin reaches `/api/admin/*`, `/api/auth/login`, `/api/auth/second-factor`,
  `/api/auth/logout`, `/api/auth/methods` and `/api/me` only.

Health: `GET /api/readiness` and `/api/admin/health` carry `adminOrigin {ok, locked}` (not
blocking, `ok` in production only when set); `/admin/tester` has an "Admin site origin" row.

**Admin email and password.** The seeded admin address (`admin@musilynk.local`) cannot receive
mail, so the second sign-in step is skipped for it (see above). The admin changes their own
address from the admin site's Account page: `POST /api/admin/account/email/request {email}`
sends a code to the **new** address; `POST /api/admin/account/email/confirm {changeToken,
code}` moves the account, marks the address verified, signs out every other browser and emails
a notice to the previous address (when it can receive mail). Reserved domains, suppressed
addresses and addresses already in use are refused. `POST /api/admin/account/password` changes
the password with the current one, signs out other browsers and voids outstanding reset links.
`GET /api/admin/account` reports `emailDeliverable` and the `secondFactor` state so the admin
site can show a banner until the second step is really on. Every change is in the audit log
(`admin.account.email_requested`, `admin.account.email_changed`, `admin.account.password_changed`).
Changing `ADMIN_EMAIL` in Railway does not change an existing account (seeds run once); set it
to the new address afterwards so a fresh database would match.

Rollout order: merge the API change with `ADMIN_ORIGIN` unset → deploy the admin site → set
`ADMIN_ORIGIN` → the owner changes the admin email to a real mailbox and signs in again with
the code. Rollback at any point: unset `ADMIN_ORIGIN` (the API is back to today's behaviour
without a code change).

### Brevo bounce and complaint webhook

Brevo reports hard bounces, soft bounces, spam complaints, blocks and unsubscribes to
`POST /api/email/webhook/brevo`. MusiLynk records each address in `email_suppressions`:

| Brevo event | Effect |
| --- | --- |
| `hard_bounce`, `invalid_email` | No email of any kind (sign-in codes, verification, reset, notifications) |
| `spam` (complaint), `blocked` | Same as a hard bounce |
| `unsubscribed` | Notification emails stop; sign-in and security emails still go |
| `soft_bounce` | Counted and shown to admins; delivery continues |

A code request for a suppressed address answers 422 `EMAIL_SUPPRESSED` with a message asking
for another address or the password, instead of silently never arriving. Admins see the counts
in `GET /api/admin/health` (`emailSuppressions`) and `/admin/tester` ("Email bounce webhook"),
and the sign-in doctor explains a suppressed address (`EMAIL_SUPPRESSED`). Replaying an event
is harmless, and a weaker event never lifts a stronger one.

Owner setup, once:

1. Generate a secret: `openssl rand -hex 32`. Set it in Railway (Rails service) as
   `BREVO_WEBHOOK_SECRET`. Without it the endpoint answers 503 to everything.
2. Brevo → Transactional → Settings → Webhook → **Add a new webhook**:
   - URL: `https://musilynk-api-production.up.railway.app/api/email/webhook/brevo`
   - Authentication: choose **Token** (sent as `Authorization: Bearer <secret>`) or **Basic**
     (any username, the secret as the password). If your Brevo screen has no authentication
     option, append `?token=<secret>` to the URL instead (the header is preferred because URLs
     can end up in proxy logs).
   - Events: Hard bounce, Soft bounce, Blocked, Spam (complaint), Invalid email, Unsubscribed.
3. Use Brevo's **Test** button or send a code to a known-bad address, then check
   `/admin/tester` shows the count.

To lift a suppression after the mailbox is fixed, remove the address from Brevo's blocklist
(Transactional → Contacts → Blocked) and delete its row:
`bin/rails runner 'EmailSuppression.where(email: "someone@example.com").delete_all'`.
- S3/R2: access keys, bucket, endpoint, region, and public base URL

## Provider integration acceptance

The provider contract tests use fake transport responses; passing them verifies request
construction and error handling, not a live provider connection. Record the outcome
of each controlled test before declaring an integration operational.

| Provider | Railway environment names | Controlled verification |
| --- | --- | --- |
| Razorpay | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_PRO`, `RAZORPAY_PLAN_STUDIO` | Follow the **Payments (Razorpay) go-live checklist** below: dashboard field mapping, webhook URL `https://musilynk-api-production.up.railway.app/api/billing/webhook/razorpay` and events, automatic capture, test-mode rehearsal, then live switch. Keep test and live credentials separate. |
| Brevo | `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_WEBHOOK_SECRET` | Verify the sending domain and sender in Brevo, then deliver a verification and reset email to controlled addresses. Check provider acceptance, inbox receipt, bounce status, and the resulting links. |
| S3-compatible storage | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_BUCKET`, `AWS_ENDPOINT_URL_S3`, `AWS_PUBLIC_BASE_URL`, optional `AWS_UPLOAD_METHOD` (see "Object storage — Cloudflare R2") | Upload, read, and delete a controlled image and audio file through the browser. Verify object durability, access policy, MIME/size rejection, CORS, and cleanup. |

Keep credentials in Railway's secret settings, not in the repository or frontend
`VITE_` variables. The public Razorpay Key ID is returned by the API only for checkout;
its Key Secret and webhook secret must stay server-side. Vercel needs the public
`VITE_API_URL` and `VITE_PUBLIC_URL` values documented above. If provider credentials
are absent, report the corresponding flow as disabled or unverified.

When Razorpay is not configured, production payment creation must fail closed; it must
never silently use mock checkout.

## Object storage — Cloudflare R2

Without `AWS_BUCKET`, production uploads return 503 unless `PERSISTENT_UPLOADS=true` with a
Railway volume, which pins the API to one replica. R2 removes that limit.

How uploads work: `POST /api/uploads/presign` records a pending `uploads` row and returns
browser upload instructions; the browser sends the file straight to the bucket; then
`POST /api/uploads/:id/complete` reads the object's size and first bytes and deletes it if
either does not match. Work samples accept only external HTTPS links or the user's own
completed uploads. Deleting a work sample deletes its file; the daily `upload_sweep` cron
(04:43 UTC) deletes pending uploads older than 24 h, completed uploads no work sample uses,
uploads whose owner was deleted, and untracked `uploads/` objects that no work sample links to.

Upload method: `AWS_UPLOAD_METHOD=post` uses a presigned POST policy (exact size, exact
Content-Type, fixed key). R2 does not document POST-policy uploads, so an
`*.r2.cloudflarestorage.com` endpoint defaults to `put`: a presigned PUT whose Content-Type
and Content-Length are signed. Both are re-verified by `complete`. Only set `post` for R2
after a controlled upload succeeds with it.

Checklist:

1. **Bucket.** Cloudflare dashboard → R2 → Create bucket, e.g. `verse-uploads` (location:
   automatic or closest to users; default storage class). Keep the bucket private to the S3
   API; public reads go through step 3.
2. **API token.** R2 → Manage API tokens → Create API token: permission *Object Read & Write*,
   scoped to `verse-uploads` only, no expiry or a tracked expiry. Record the Access Key ID,
   Secret Access Key and the account's S3 endpoint
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. **Public reads.** Bucket → Settings → Custom Domains → connect e.g. `media.<your-domain>`
   (the zone must be on Cloudflare). For a trial only, enable the `r2.dev` subdomain instead;
   it is rate-limited and not meant for production.
4. **CORS.** Bucket → Settings → CORS policy:

   ```json
   [
     {
       "AllowedOrigins": ["https://musilynk.vercel.app"],
       "AllowedMethods": ["PUT", "POST", "GET", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Add any other production frontend origin (custom domain) to `AllowedOrigins`; never `*`.
5. **Railway variables** (API service, secret settings):

   | Variable | Value |
   | --- | --- |
   | `AWS_ACCESS_KEY_ID` | R2 token Access Key ID |
   | `AWS_SECRET_ACCESS_KEY` | R2 token Secret Access Key |
   | `AWS_REGION` | `auto` |
   | `AWS_BUCKET` | `verse-uploads` |
   | `AWS_ENDPOINT_URL_S3` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
   | `AWS_PUBLIC_BASE_URL` | `https://media.<your-domain>` (or the `https://pub-….r2.dev` URL) |
   | `AWS_UPLOAD_METHOD` | leave unset (→ `put` on R2) |

   `AWS_PUBLIC_BASE_URL` is mandatory with a custom endpoint; without it uploads return 503
   `STORAGE_MISCONFIGURED`. Nothing storage-related goes into Vercel `VITE_` variables.
6. **CSP.** `vercel.json` already allows `connect-src https://*.r2.cloudflarestorage.com`
   (browser upload) and `img-src`/`media-src https:` (playback). PDFs open in a new tab, so no
   `frame-src` change is needed.
7. **Verify.** `GET /api/admin/health` → `checks.storage.ok: true`, `uploadMethod: "put"` and
   no `problems` (codes such as `missing_credentials`, `missing_public_base_url`,
   `insecure_endpoint`; values are never echoed). The admin tester's "Upload storage" check
   shows the same. Then, in the browser, upload an image, an MP3 and a PDF on
   `/jobseeker/library`, play them, confirm a renamed `.txt → .png` is rejected, delete each
   sample and confirm the object is gone from the bucket.
8. **After migrating.** Remove `PERSISTENT_UPLOADS` and the volume only after existing
   `/rails/active_storage/...` work samples have been re-uploaded or accepted as lost; the
   Disk files live only on that volume.

## Payments (Razorpay) go-live checklist

Owner steps, in order. Nothing here is automated; tick each item and record the date.

### 1. Railway variables ← Razorpay dashboard

Set these on the Railway **API service** (production environment). Never in Vercel.

| Railway variable | Razorpay dashboard field (Live mode unless stated) |
| --- | --- |
| `RAZORPAY_KEY_ID` | Account & Settings → API Keys → **Key Id** (`rzp_live_…`) |
| `RAZORPAY_KEY_SECRET` | Account & Settings → API Keys → **Key Secret** (shown once when the key is generated; regenerate if lost) |
| `RAZORPAY_WEBHOOK_SECRET` | Account & Settings → Webhooks → your webhook → **Secret** (you choose it; use `openssl rand -hex 32`) |
| `RAZORPAY_PLAN_PRO` | Subscriptions → Plans → the Pro plan's **Plan ID** (`plan_…`): Monthly, every 1 month, **INR 2,499.00** |
| `RAZORPAY_PLAN_STUDIO` | Subscriptions → Plans → the Studio plan's **Plan ID**: Monthly, every 1 month, **INR 5,999.00** |
| `RAZORPAY_PLAN_PRO_ANNUAL` | Subscriptions → Plans → the Pro annual plan's **Plan ID**: every 12 months, **INR 24,990.00**. Until both annual ids are set the pricing page hides the monthly/annual toggle and annual checkout answers 503 |
| `RAZORPAY_PLAN_STUDIO_ANNUAL` | Subscriptions → Plans → the Studio annual plan's **Plan ID**: every 12 months, **INR 59,990.00** |
| `RAZORPAY_REFERRAL_OFFER_ID` | Offers → the referral offer (20% off for 3 billing cycles) → **Offer ID** (`offer_…`). Referral codes are refused at live checkout without it. Each discount code's own offer id is pasted in the admin Codes tab |
| `RAZORPAY_ALLOW_TEST_MODE` | not a dashboard field: set `true` **only** during the test-mode rehearsal below, then delete |
| `RAZORPAY_SIMULATOR` | must **not** exist on Railway (it is ignored in production and `GET /api/admin/health` reports `checks.payments.ok: false` if present) |

The plan amounts must match `Billing::BillingController::PLANS` (the server sends only the
plan id; Razorpay charges what the plan says). Test-mode and live-mode keys, plans and
webhooks are separate objects in Razorpay: create each in both modes.

### 2. Webhook

Account & Settings → Webhooks → Add New Webhook (in each mode):

- Webhook URL: `https://musilynk-api-production.up.railway.app/api/billing/webhook/razorpay`
- Secret: the value of `RAZORPAY_WEBHOOK_SECRET`
- Active events: `subscription.authenticated`, `subscription.activated`, `subscription.charged`,
  `subscription.pending`, `subscription.halted`, `subscription.paused`, `subscription.resumed`,
  `subscription.cancelled`, `subscription.completed`, `payment.captured`, `payment.failed`,
  `refund.processed`. (Other events are recorded and ignored.)

### 3. Payment capture

Account & Settings → Payment Capture → **Automatic capture** (immediate). Deposit
confirmation requires a `captured` payment; an authorised-but-uncaptured payment is refused
and Razorpay auto-refunds it later.

### 4. Test-mode rehearsal on Railway (before any live key)

1. Set the test-mode `rzp_test_` key id/secret, test-mode plan ids, the test-mode webhook
   secret, and `RAZORPAY_ALLOW_TEST_MODE=true`. Redeploy.
2. `GET /api/admin/health` → `checks.payments.ok` is true with `mode: "test"`, and the Billing page shows
   the **Test mode** banner.
3. As a throwaway employer: Billing → Pro → Start free trial → complete checkout with a
   Razorpay test card that supports recurring payments. The page moves to **Free trial**
   within seconds; Admin → `GET /api/admin/billing-events` shows `subscription.authenticated`
   with `processingResult: applied`.
4. Cancel from the Billing page (trial cancellation is immediate) and confirm the Razorpay
   dashboard shows the subscription cancelled.
5. Booking deposit: accept a quote, pay the deposit with a test card → **Deposit paid ·
   booking confirmed**; repeat with a failing test card → decline message and retry works.
6. Refund that deposit from the Razorpay dashboard → `refund.processed` arrives and the
   booking shows **Deposit refunded**.
7. `GET /api/admin/billing-attempts` has no `pending`/`ambiguous` rows older than 30 minutes.

### 5. Go live

Replace the four Razorpay values with live-mode ones, **delete** `RAZORPAY_ALLOW_TEST_MODE`,
redeploy, confirm the Test mode banner is gone, then make one real low-value deposit on a
controlled booking and refund it from the dashboard. Record the outcome here.

### Local rehearsal without credentials (Razorpay simulator)

`RAZORPAY_SIMULATOR=true` with any `rzp_test_` key makes the API answer Razorpay calls from
`RazorpaySimulator` (in-process, no network) and replaces checkout.js with a simulated modal
(success / decline / close) whose handler payload is signed server-side. It is refused in
production and with live keys; its dev endpoints (`/api/dev/razorpay/*`: checkout,
`subscriptions/:id/{activate,charge,pending,halt,pause,resume,cancel,complete}`,
`payments/:id/refund`, `webhooks`) are not routed there. Simulator state is in memory:
restarting the API or reloading code clears it.

```bash
RAZORPAY_SIMULATOR=true RAZORPAY_KEY_ID=rzp_test_simulator RAZORPAY_KEY_SECRET=local_sim_secret \
RAZORPAY_WEBHOOK_SECRET=local_sim_webhook RAZORPAY_PLAN_PRO=plan_SimPro RAZORPAY_PLAN_STUDIO=plan_SimStudio \
  bin/rails server -p 3000            # in backend/, development env
QA_PAYMENTS_SIMULATOR=true QA_API_BASE_URL=http://127.0.0.1:3000/api npx playwright test tests/e2e/payments-simulator.spec.ts
```

The same flows run in `backend/test/integration/razorpay_simulator_flows_test.rb` on every
`bin/rails test`.

## Release gate

Every release must pass exactly what CI runs (`.github/workflows/rails-and-web.yml`). From the
repository root:

```bash
npm ci
npm audit --omit=dev --audit-level=high
npm run typecheck && npm run lint && npm run format:check
npm run build && npm run check:bundle && npm run check:split
npm run test:all
npm run test:unit -- --coverage
npm run qa:e2e
```

Then, in `backend/` (test database as in the README):

```bash
bundle install
bin/rails db:prepare
bin/rails test
bin/rails zeitwerk:check
bundle exec brakeman --no-pager --exit-on-warn --exit-on-error
bundle exec bundler-audit check --update
```

After any migration, regenerate `db/schema.rb` the way CI does: drop the database,
delete `db/schema.rb`, run `bin/rails db:create db:migrate`, and commit the result.

CI runs these as the `frontend` (npm audit, typecheck, lint, format, build, bundle budget,
public/admin split, `test:all`, unit tests), `rails` (an empty-database migration, the
`db/schema.rb` drift check, the test suite, `zeitwerk:check`), `security` (Brakeman,
bundler-audit) and `integrated-journeys` jobs. `npm run test:all` runs only the frontend source
smoke tests; the legacy Node server and its tests were removed.

Coverage floors: `bin/rails test` measures line and branch coverage with SimpleCov
(`backend/coverage/index.html`) and, on CI, fails when either drops below the floor in
`backend/test/test_helper.rb` (set `COVERAGE_FLOOR=1` to enforce it locally on a full run).
`npm run test:unit -- --coverage` does the same for `src/app/lib` with the thresholds in
`vitest.config.ts`. Raise a floor when coverage goes up; never lower it to get a build green.

Signed-in live smoke: the scheduled and manual `MusiLynk QA Agent` live run also signs in as a
dedicated jobseeker test account, saves and deletes a job alert, and signs out
(`tests/e2e/live-account-smoke.spec.ts`). It skips itself until the `QA_SMOKE_EMAIL` and
`QA_SMOKE_PASSWORD` repository secrets are set. Use an account created only for this, with
no real profile data, and keep `PASSWORD_LOGIN_ENABLED` on (it signs in with a password).

The Railway image (`backend/Dockerfile`, build context = repository root) installs exactly the
gems in `backend/Gemfile.lock` with the Bundler version recorded there, in frozen deployment
mode. Build-context ignore rules are in `backend/Dockerfile.dockerignore`. Production never
rewrites `db/schema.rb` (`dump_schema_after_migration = false`).

The `integrated-journeys` CI job also builds the Vite frontend against a Rails server
and disposable PostgreSQL test database. It exercises both account roles through
registration, profile saving, logout, login, and server-side admin denial. It uses
reserved `example.invalid` addresses and never calls production providers. The
regular public-page browser checks use local API fixtures; their success alone does
not verify the Rails integration.

After deployment verify:

1. `/api/live`, `/api/health`, and `/api/readiness`.
2. Registration, verification, login, logout, and session expiry.
3. Candidate discovery, save, application, messaging, and availability.
4. Employer posting, application review, workspace, booking, and notifications.
5. Admin moderation and audit logging.
6. One controlled payment, webhook, refund, and reconciliation cycle after Razorpay is live
   (steps in the Payments go-live checklist).
7. One real transactional email after Brevo is live.
8. One upload/read/delete lifecycle after object storage is live.

## Error alerting and uptime

Error tracking is built in but **inert until a DSN is set**: with no DSN the API never
initialises Sentry and the web app never downloads it (zero requests to Sentry).

### 1. Create the Sentry projects (one time)

1. Sign up at sentry.io (the free Developer plan is enough to start) and create an
   organisation, e.g. `verse`. Pick the data region you prefer (US or EU); the CSP in
   `vercel.json` already allows `*.ingest.sentry.io`, `*.ingest.us.sentry.io` and
   `*.ingest.de.sentry.io`.
2. Create two projects:
   - `verse-api`, platform **Rails**;
   - `verse-web`, platform **React**.
3. Copy each project's DSN (Project settings → Client Keys (DSN)). A DSN is not a secret in
   the browser, but keep it out of the repository anyway.

### 2. Where each value goes

| Where | Variable | Value |
| --- | --- | --- |
| Railway (Rails service) | `SENTRY_DSN` | `verse-api` DSN |
| Railway | `SENTRY_ENVIRONMENT` | optional, defaults to `RAILS_ENV` (`production`) |
| Railway | `SENTRY_TRACES_SAMPLE_RATE` | optional, default `0.02` once `SENTRY_DSN` is set (2% of requests traced for performance data); `0` turns tracing off |
| Vercel (Production environment) | `VITE_SENTRY_DSN` | `verse-web` DSN |
| Vercel (Production environment) | `VITE_SENTRY_ENVIRONMENT` | `production` (Preview deployments can use `preview`, or leave the DSN unset there) |
| Vercel | `VITE_SENTRY_TRACES_SAMPLE_RATE` | optional, default `0.05` once `VITE_SENTRY_DSN` is set; `0` turns tracing off. Core Web Vitals are sent as metrics either way (see docs/PERFORMANCE.md) |

Releases are automatic: the API reports `RAILWAY_GIT_COMMIT_SHA` and the web build uses
`VERCEL_GIT_COMMIT_SHA` (exposed as `<meta name="musilynk-release">`). `VITE_*` values are read
at build time, so **redeploy Vercel after changing them**. Railway restarts on variable changes.

What is sent, and what is not:

- API: unhandled exceptions (500s), rescued errors that still answer 5xx (e.g. Razorpay
  gateway failures), errors the code swallows and logs (email enqueue/delivery, notification
  email, demo data jobs, upload sweep, billing reconciliation, checkout cleanup), GoodJob
  failures (discarded or retries exhausted — job class and job id only, never arguments),
  and GoodJob internal thread errors. Expected 4xx errors (not found, validation, bad
  request, routing) are never sent.
- Web: render crashes (app error boundary and route error page; a stale-chunk error only
  after the one automatic reload has failed), unhandled errors and promise rejections, and
  API 5xx/timeout/network failures rate-limited to one per kind per 5 minutes and at most 5
  per page session. API 4xx responses are never sent. Session replay is off.
- Privacy: no request bodies, cookies, query strings, IP addresses or job arguments; emails
  (also URL-encoded), bearer tokens, the `musilynk_access_token` value, `Authorization`/cookie
  headers and password/token/code/otp/secret/signature/body fields are scrubbed before
  sending. Users are identified by internal id and role only.

### 3. Alert rules (Sentry → Alerts → Create alert → Issues), for each project

1. **New issue** — "A new issue is created" → email the owner (and the team, if any).
   This also covers billing mismatches: when the half-hourly reconciliation job finds an
   attempt whose Razorpay order or subscription disagrees with MusiLynk (wrong amount or
   currency, or the local payment was already released), it reports one
   `BillingReconciliationJob::Mismatch` event per run tagged
   `source=billing_reconciliation_mismatch` with the fixed fingerprint
   `billing-reconciliation-mismatch`, so every run groups into one issue and alerts once.
   The event lists up to 20 attempt ids; open them in `/admin` → Billing attempts.
2. **Spike** — "Number of events in an issue is more than 20 in 5 minutes" → email.
3. **Regression** — "The issue changes state from resolved to unresolved" → email.

Also enable Settings → Account → Notifications → "Workflow" and "Issue alerts" email, and
install the Sentry mobile app if you want push alerts.

### 4. Cost

The free Developer plan includes a fixed monthly error quota (about 5k errors at the time of
writing) and one user; check sentry.io/pricing for current limits. To stay inside it:
tracing samples only 2% (API) and 5% (web) by default, replay is off, API failure bursts in the browser are rate limited, and
expected 4xx are dropped. Set a spike-protection/quota limit per project in Sentry
(Settings → Subscription/Spend) so a bad deploy cannot exhaust the month. Raise
`SENTRY_TRACES_SAMPLE_RATE` / `VITE_SENTRY_TRACES_SAMPLE_RATE` only deliberately.

### 5. Verify after setting the DSNs

1. Sign in as an admin and open `/admin/tester` → **Error alerting**.
2. **Send server test error** calls `POST /api/admin/health/sentry-test` (admin only,
   audited as `admin.sentry_test`). It answers `captured: true` with an event id when
   `SENTRY_DSN` is set, `captured: false` when it is not. The event appears in `verse-api`
   as `Admin::HealthController::SentryTestError`, tagged `musilynk_test=true`.
3. **Send test error** (shown only when the build has `VITE_SENTRY_DSN`) sends a tagged client
   error to `verse-web`.
4. Confirm the "new issue" alert emails arrive, then resolve both test issues.

### 6. Uptime monitoring (free)

Use UptimeRobot (free: 50 monitors, 5-minute interval) or Better Stack Uptime (free tier):

| Monitor | URL | Check |
| --- | --- | --- |
| MusiLynk API | `https://musilynk-api-production.up.railway.app/api/health` | HTTP 200, keyword `"ok":true` |
| MusiLynk web | `https://musilynk.vercel.app` | HTTP 200 |

Interval 5 minutes, alert contact = owner email, alert after 2 consecutive failures to avoid
noise from a single cold start. (`/api/readiness` answers 503 while a core dependency is down;
add it as a third monitor if you want database outages to page separately.)

### 7. Deploy verification without opening Railway

After merging to `production`, run **Actions → MusiLynk QA Agent → Run workflow** on the
`production` branch. For manual runs the live job sets `QA_EXPECTED_RELEASE` to the
workflow's commit, and `tests/e2e/api-health.spec.ts` polls for up to 5 minutes until
`GET /api/health` reports that commit (first 12 characters) and the web app's
`<meta name="musilynk-release">` matches it. A red run means Railway or Vercel did not deploy
that commit. Scheduled runs skip this check because they may legitimately test an older
deploy. `window.__MUSILYNK_RELEASE__` in the browser console shows the running web build.

### 8. Operations view (`/admin` → Operations)

A first look at production health without opening Railway, Sentry or GoodJob. The tab
calls `GET /api/admin/operations` (admins only; everyone else gets 401/403) and refreshes
every minute.

| Panel | What it shows | Where it comes from |
| --- | --- | --- |
| API traffic | Request count, p95 latency and 5xx rate for the last hour and last 24 hours | `request_metric_minutes` (below) |
| Background jobs | Queued, oldest queued age, running, scheduled or waiting to retry, failed in 24 h (by job class), errored runs in 24 h | GoodJob tables |
| Payments (24 h) | Booking deposits failed / still pending; billing attempts failed / unresolved | `booking_payments`, `billing_attempts` |
| Email (24 h) | Email jobs GoodJob gave up on, sends that errored and were retried, addresses the provider reported (hard/soft bounce, complaint, blocked, unsubscribed), suppressed addresses, and a warning when the bounce webhook is not configured | GoodJob tables, `email_suppressions` |

Figures turn amber when they need a look: 5xx rate at or above 1%, p95 over 1 s, a job
queued for 10 minutes or more, or any failed job, payment or email delivery. They are
prompts, not alerts; Sentry (above) remains the alerting path.

How request metrics are collected: `RequestMetrics::Middleware`
(`backend/config/initializers/request_metrics.rb`) sits outside Rails' exception handling,
so it sees the status the client actually got. Each `/api` request (except the
`/api/health`, `/api/live` and `/api/readiness` probes) adds a few integers to an in-memory
buffer in its web process. At most every `REQUEST_METRICS_FLUSH_SECONDS` (default 10) one
request writes the buffer to `request_metric_minutes` with a single upsert that sums into
the minute's row (so several web processes or replicas add up) and deletes rows older than
25 hours; the table never holds more than about 1,500 rows. A failed write is logged as
`request_metrics_write_failed` and that batch is dropped; the request is never affected,
and at most 30 minutes are buffered in memory. Latency is kept as a histogram with bucket
edges from 5 ms to 10 s, so p95 is shown as "≤ the bucket's upper edge" (or "> 10 s").
Numbers start from the first deploy that includes this table, and a process restart loses
at most its last few seconds of counts.

Not shown: the nightly database backup runs in GitHub Actions and leaves nothing in the
app's database. Check **Actions → Database backup**; a failed run opens an issue labelled
`backup-failure` and, when `ALERT_WEBHOOK_URL` is set, posts to it (see Backups and
rollback below). Email provider rejections (4xx from Brevo) are logged as `email_delivery_skipped` /
`notification_email_skipped` rather than counted.

## Backups and rollback

Railway's current trial does not provide managed backups or point-in-time recovery, so
`.github/workflows/db-backup.yml` takes a nightly (03:00 IST) off-Railway backup:

1. `scripts/db/backup.sh` runs `pg_dump --format=custom`, records a SHA-256 checksum and a
   manifest of per-table row counts, and encrypts the dump with GPG (AES-256).
2. `scripts/db/restore-verify.sh` restores that dump into a throwaway PostgreSQL of the same
   major version and fails the run if the checksum, `pg_restore`, or any table is missing.
   Row-count differences (writes during the dump) are warnings.
3. The encrypted dump, checksum and manifest are kept as a workflow artifact for 30 days.
4. When `BACKUP_S3_BUCKET` is set, the same three files (encrypted only, never the plaintext
   dump) are copied to Cloudflare R2 or any S3-compatible bucket under
   `verse-db/YYYY/MM/DD/run-<run id>/`, and the dump's size is read back to confirm the upload.
   With the secret unset the step is skipped.
5. If the run fails or is cancelled, a second job opens a GitHub issue labelled
   `backup-failure` (or comments on the open one), which GitHub emails to the repository owner.
   The next green run closes it. If the `ALERT_WEBHOOK_URL` secret is set, the same alert is
   also POSTed there as JSON (`text` and `content` fields, so Slack and Discord incoming
   webhooks work as-is).

A green run is therefore a backup that was restored successfully. Setup, once:

- Repository secret `PRODUCTION_DATABASE_URL`: the Railway Postgres service's
  `DATABASE_PUBLIC_URL` (public networking must be on).
- Repository secret `BACKUP_PASSPHRASE`: a long random passphrase. Store a copy outside
  GitHub (password manager); without it the backups cannot be decrypted.
- Run the workflow once by hand (Actions -> Database backup -> Run workflow) and confirm it passes.
- GitHub → your profile → Settings → Notifications: keep email on for "Issues" on repositories
  you own/watch, so the `backup-failure` issue reaches your inbox. Nothing else is needed for
  the alert; it uses the workflow's built-in token.
- Optional: repository secret `ALERT_WEBHOOK_URL` (a Slack or Discord incoming webhook URL).

Off-GitHub copies in Cloudflare R2 (recommended; the GitHub artifact alone lives only 30 days
and shares an account with the code):

1. Cloudflare → R2 → **Create bucket** `verse-db-backups` (separate from the uploads bucket,
   no public access, no custom domain).
2. Bucket → Settings → **Object lifecycle rules** → Add rule: prefix `verse-db/`, action
   "Delete uploaded objects" after **90 days** (use 35 if you only want a month; the dump is
   already encrypted, so longer retention is safe). Optionally also turn on **Bucket lock**
   for the same prefix and period so a leaked key cannot delete recent backups.
3. R2 → **Manage API tokens** → Create token with **Object Read & Write** limited to that bucket.
4. Repository secrets (Settings → Secrets and variables → Actions):
   - `BACKUP_S3_BUCKET` = `verse-db-backups`
   - `BACKUP_S3_ENDPOINT` = `https://<account id>.r2.cloudflarestorage.com`
   - `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` = the token's S3 credentials
   - `BACKUP_S3_REGION` optional (defaults to `auto`, right for R2; AWS S3 needs the bucket
     region and no endpoint)
5. Run the workflow by hand and confirm the files appear under `verse-db/<today>/`.

Restoring for real (into a new Railway Postgres, never over the live one until verified):

```bash
# Download and unzip the artifact from the chosen run, then:
SCRATCH_DATABASE_URL=<new database URL> BACKUP_PASSPHRASE=<passphrase> \
  scripts/db/restore-verify.sh musilynk-<stamp>.dump.gpg
```

Point the Rails service's `DATABASE_URL` at the restored database only after that check passes.
To restore from R2 instead of an artifact, download the three files from
`verse-db/YYYY/MM/DD/run-<id>/` (Cloudflare dashboard, or
`aws s3 cp --recursive --endpoint-url <endpoint> s3://<bucket>/verse-db/YYYY/MM/DD/run-<id>/ .`)
and run the same command. Without the R2 copy, history is only the 30 days of artifacts.

Rollback application code by redeploying the last known-good `production` commit.
Database migrations must remain backward-compatible with the previous application release.

## Reversible synthetic QA batches

Synthetic batches use reserved `example.invalid` addresses and are tagged in
`users.synthetic_batch`. They never create an admin account, send registration email,
or call a real payment provider.

```bash
cd backend
BATCH=qa-YYYY-MM-DD JOBSEEKERS=225 EMPLOYERS=75 bin/rails synthetic_qa:seed
bin/rails synthetic_qa:list
BATCH=qa-YYYY-MM-DD bin/rails synthetic_qa:purge
```

Production additionally requires temporary `ALLOW_SYNTHETIC_QA=true` and
`SYNTHETIC_QA_PASSWORD`. Take a verified backup first, start with a small canary batch,
purge it, then run the full batch. Remove temporary variables immediately afterward.
Purge is transactional and idempotent.
