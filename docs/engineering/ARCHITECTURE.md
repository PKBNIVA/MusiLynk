# MusiLynk architecture map

What runs where, and how a request moves through it. Written from the code on `production` on
2026-10-03; file paths are the place to look when this page and the code disagree. The shorter
overview with the security boundary and the domain model is [../../ARCHITECTURE.md](../../ARCHITECTURE.md).

## The pieces

```text
                 ┌──────────────── Vercel ────────────────┐
 Browser ──────► │ musilynk (public build, dist/)         │
                 │ musilynk-admin (VITE_APP_TARGET=admin) │
                 │ vercel.json: CSP, rewrites, cache      │
                 └───────┬───────────────────┬────────────┘
                         │ /api/public/*,    │ VITE_API_URL
                         │ /sitemap.xml      │ (direct, bearer token)
                         ▼ (same-origin      ▼
                 ┌─────── rewrites, edge cached) ──────────┐
                 │ Railway: musilynk-api (Puma, Rails 8.1) │
                 │ Railway: musilynk-worker (GoodJob)      │
                 │ Railway: Postgres (data, jobs, cache)   │
                 └───┬──────┬──────┬──────┬──────┬────────┘
                     ▼      ▼      ▼      ▼      ▼
                    R2   Razorpay Brevo WhatsApp Sentry
```

| Piece | What it is | Where in the repo |
| --- | --- | --- |
| Public web build | React 18 SPA, Vite 8. Pages lazy-load from the route table. `npm run build` runs `vite build` then writes a per-route `<head>` and `app-shell.html` into `dist/`. | `src/main.tsx`, `src/app/routes.tsx`, `scripts/prerender-heads.mjs`, `vite.config.ts` |
| Admin web build | The same code built with `VITE_APP_TARGET=admin` into `dist-admin/`; `npm run check:split` proves no admin code ships in the public build. | `package.json` (`build:admin`), `scripts/check-site-split.mjs` |
| Vercel | Hosts both builds. `vercel.json` holds the CSP, the SPA rewrites to `app-shell.html`, the crawler rewrites to the API's `/share/*` pages, the same-origin rewrites for the three edge-cached public reads and the sitemap, and the cache headers for `/assets` and `/img`. | `vercel.json` |
| API | Rails 8.1 JSON API under `/api`. One controller per resource; `admin/`, `billing/`, `stage/`, `employer/` namespaces. `/api/live` and `/api/health` answer from the process; `/api/readiness` checks the database, GoodJob tables and required variables. | `backend/config/routes.rb`, `backend/app/controllers/`, `backend/app/services/readiness_checks.rb` |
| Worker | GoodJob in its own Railway service (`bin/worker` → `good_job start`). Thread pools per queue group: `urgent` 2, `notifications`+`mailers` 2, `default`+`scheduled` 1. Cron lives in one initializer. | `railway.worker.toml`, `backend/bin/worker`, `backend/config/job_queues.yml`, `backend/config/initializers/good_job.rb` |
| Postgres | One database on Railway: application data, the GoodJob queue, Solid Cache entries (rate-limit counters, public stats, the sitemap). Every connection sets `statement_timeout` and `lock_timeout`; JIT is off. Pool size = Puma threads + GoodJob threads + 3. | `backend/config/database.yml`, `backend/config/database_session_settings.rb`, `backend/config/cache.yml` |
| R2 | Cloudflare R2 through the S3 API. The browser uploads straight to the bucket with a presigned PUT; the API verifies size and first bytes on `complete`. Public reads go through `UPLOADS_PUBLIC_BASE_URL` when set, else `AWS_PUBLIC_BASE_URL`. | `backend/app/services/upload_storage.rb`, `backend/app/controllers/uploads_controller.rb`, `docs/ops/uploads.md` |
| Railway | Runs the API from `backend/Dockerfile` with `railway.toml` (pre-deploy `db:prepare && sitemap:warm`, health check `/api/live`), the worker with `railway.worker.toml`, and Postgres. Deploys only after the five required CI checks pass on the merge commit. | `railway.toml`, `railway.worker.toml`, `backend/Dockerfile` |
| Brevo | Transactional email over HTTPS (`api.brevo.com/v3/smtp/email`). Bounces and complaints come back to `POST /api/email/webhook/brevo` and land in `email_suppressions`. | `backend/app/services/email_delivery.rb`, `backend/app/jobs/email_delivery_job.rb`, `backend/app/jobs/notification_email_job.rb`, `backend/app/controllers/email_webhooks_controller.rb` |
| Razorpay | Subscriptions, booking deposits, refunds. The server creates orders; only signed webhooks (`POST /api/billing/webhook/razorpay`) change subscription state; `BillingReconciliationJob` repairs the rest twice an hour. | `backend/app/controllers/billing/billing_controller.rb`, `backend/app/services/razorpay_gateway.rb`, `backend/app/jobs/billing_reconciliation_job.rb`, `SAAS_BILLING.md` |
| WhatsApp | Cloud API (`graph.facebook.com`) template messages for urgent-hire alerts, and OTP. Off unless `WHATSAPP_ENABLED` and its three variables are set. | `backend/app/services/whatsapp_alerts.rb`, `backend/app/services/whatsapp_otp.rb`, `backend/app/jobs/whatsapp_alert_job.rb` |
| Web push | VAPID web push from the worker. Off unless the three `VAPID_*` variables are set. The service worker does push only, no caching. | `backend/app/services/push_notifications.rb`, `backend/app/jobs/push_delivery_job.rb`, `src/app/lib/push.ts`, `public/sw.js`, `docs/ops/web-push.md` |
| Sentry | `verse-api` (Rails) and `verse-web` (React). Both scrub before sending. The web SDK loads after the page's `load` event plus an idle period, never with the first paint. | `backend/config/initializers/sentry.rb`, `backend/app/services/error_scrubber.rb`, `src/app/lib/monitoring.ts`, `src/app/lib/sentryScrub.ts` |

The frontend has one HTTP client, `src/app/lib/api.ts`: timeouts, bounded retries honouring
`Retry-After`, the error shape, and `viaEdge` for the three public reads. The session token is a
bearer token in `localStorage` (`src/app/lib/authContext.tsx`).

## How a request flows

### 1. An anonymous visitor opens a public page

Example: `https://musilynk.vercel.app/`.

1. **Vercel serves HTML.** `/` maps to `dist/index.html`; a route like `/music-jobs` maps to its
   pre-rendered `dist/music-jobs/index.html`; dynamic URLs (`/professionals/123`) fall through
   to `app-shell.html` (`vercel.json` rewrites). Each file already has the right `<title>`,
   description, canonical and social tags, written at build time by `scripts/prerender-heads.mjs`
   from the same strings the pages render. The home page also gets a `<link rel=preload>` for the
   AVIF hero. (PR #180 extends this to the full first screen of nine public pages, hydrated in
   place.)
2. **The browser loads the entry chunk.** `src/main.tsx` installs the chunk-reload guard, calls
   `initMonitoring` (a no-op until Sentry is scheduled later) and renders `App`. The route table
   in `src/app/routes.tsx` lazy-loads the page chunk. `vite.config.ts` groups everything the first
   paint needs into one entry chunk, so the first paint pays three files, not nine.
3. **Three reads go to the edge.** The landing page calls `apiGet(path, { viaEdge: true })` for
   `/api/public/stats`, `/api/public/talent` and the Stage teaser. `viaEdge` sends them to
   `VITE_PUBLIC_API_BASE` (`/api` on Vercel), and `vercel.json` rewrites those same-origin paths
   to the Railway host. Vercel's edge caches the answer because the API marks it cacheable.
4. **The API answers once a minute.** `PublicCaching#public_cache!`
   (`backend/app/controllers/concerns/public_caching.rb`) adds
   `Cache-Control: public, s-maxage=N, stale-while-revalidate=M`, a weak ETag and
   `Vary: Authorization` to an **anonymous GET only**. Lifetimes come from
   `backend/config/edge_cache.yml` (stats 300 s, listings and shows 60 s, sitemap 3600 s). A
   signed-in request to the same URL keeps Rails' private, no-store default, so an anonymous body
   is never reused for a bearer-token request. A repeat visit with `If-None-Match` gets a 304.
5. **Everything else goes direct.** Any other read (`/api/jobs`, `/api/public/acts`) is called on
   `VITE_API_URL` and still carries the public cache headers for browsers and proxies, but it
   does not pass through Vercel's edge.
6. **Crawlers and link previews.** A WhatsApp or Google user-agent asking for `/professionals/:id`
   is rewritten to the API's `/share/professionals/:id`
   (`backend/app/controllers/share_pages_controller.rb`), which renders a small HTML page with the
   right tags. `/sitemap.xml` is also rewritten to the API, which serves what `SitemapRefreshJob`
   built into the cache (hourly) and answers 503 with `Retry-After` on a cache miss while it
   queues one rebuild (`backend/app/controllers/sitemaps_controller.rb`).

### 2. A signed-in user sends a chat message

Example: a hirer replies in `/messages?c=42`.

1. **The browser posts.** `src/app/pages/Messages.tsx` calls `POST /api/conversations/42/messages`
   through `api.ts` with the bearer token. While the thread is open it polls
   `GET /api/conversations/42/messages` every 3 s and the inbox every 10 s
   (`useVisiblePolling`, `src/app/lib/usePolling.ts`); polling pauses when the tab is hidden.
   The unread badge in `Navigation.tsx` polls `GET /api/notifications/unread` every 10 s.
2. **The API validates and writes.** `MessagesController#create`
   (`backend/app/controllers/messages_controller.rb`) checks the body is present and under the
   length limit, that the counterpart is active and has not blocked the sender, and the per-user
   hourly rate limit (Solid Cache counter). It saves the message, runs `flag_scam_signals`
   (signals never block sending; they drive a notice and a moderator count), and calls
   `Notifier.new_message`.
3. **One in-app notification, debounced.** `Notifier.new_message`
   (`backend/app/services/notifier.rb`) locks the conversation, then keeps **one** unread
   notification per (recipient, conversation): a second message within the same unread window
   updates the existing row's title to "N new messages from …" instead of adding another. The
   `Notification` row is the record of truth; everything after it is best effort.
4. **Push is queued.** `Notifier#push` → `PushNotifications.notify` → `PushDeliveryJob` on the
   `mailers` queue (urgent pushes ride `urgent`). The job runs in the worker: for each sendable
   `PushSubscription` it sends an encrypted VAPID push; a 404/410 deletes the device, any other
   failure backs off and drops the device after eight in a row. Nothing is retried by the queue.
   The job is skipped entirely if the user turned the "messages" category off or the `VAPID_*`
   variables are unset. A queue failure is logged and reported, never surfaced to the sender.
5. **Email is queued, at most once per interval.** If the recipient has not had a message email
   for this conversation recently and has not opted out, `NotificationEmailJob` is queued on
   `mailers`. In the worker it renders the template (`NotificationEmail.render`), posts to Brevo
   (`EmailDelivery.deliver_rendered`), retries connection errors and 5xx up to five times, and
   logs a counts-only line on a 4xx. The job row holds the user id and display values, never the
   address or the message text.
6. **The recipient's browser catches up.** Their inbox poll sees the new message within 3 s if
   the thread is open, or the badge poll within 10 s. Opening the thread calls
   `mark_read!`, which clears the message notification (`Notifier.conversation_read`) and skips
   the UPDATE when nothing is unread.

### 3. A hirer posts an urgent request

Example: "Need a tabla player in Mumbai tomorrow evening" from `/urgent`.

1. **The browser posts.** `POST /api/urgent-requests` with city, role or instrument, start time,
   title and budget.
2. **The API writes and returns immediately.** `UrgentRequestsController#create`
   (`backend/app/controllers/urgent_requests_controller.rb`) enforces 10 creates per user per
   hour, sets `expires_at` from `backend/config/urgent.yml` (`expire_after_hours`, 48) and
   `match_status: pending`, saves, and **after the commit** enqueues `UrgentMatchJob` on the
   `urgent` queue. The response carries the "we're on it" promise text from the same config file.
   An enqueue failure is logged with ids only; the request stays `pending` for the sweep.
3. **The worker claims the request.** `UrgentMatchJob` (`backend/app/jobs/urgent_match_job.rb`)
   claims it with one conditional UPDATE (`pending` → `matching`, or a `matching` claim older
   than 10 minutes left by a dead worker). Exactly one run does the work; a duplicate enqueue or
   a retry finds nothing to claim. `UrgentMatchSweepJob` (cron, every 5 minutes) re-enqueues
   anything still `pending`.
4. **The matcher ranks candidates.** `UrgentMatcher` (`backend/app/services/urgent_matcher.rb`)
   scopes musicians to the city (trigram index on `profiles.location`), matches role or
   instrument through the shared vocabulary (`Search::Synonyms`, so "gayak" matches "singer"),
   drops anyone whose availability blocks the date, and scores verified status, city match and
   recent activity. It keeps the top `candidate_limit` (30) and notifies the top
   `notify_count` (15); both numbers are in `urgent.yml`.
5. **Each candidate is alerted once per channel.** `notify_one` inserts a
   `(request, user, channel)` row first; a unique index makes a repeat a no-op, so a retry after
   a partial run never alerts twice.
   - **In-app, push and email** go through `Notifier.urgent_request_alert`: the `Notification`
     row, a push in the `urgent` category, and `NotificationEmailJob` with the
     `urgent_request_alert` template. `config/job_queues.yml` routes that template and that push
     category onto the `urgent` pool, so a burst of digest emails on `mailers` never delays them.
   - **WhatsApp** is queued as `WhatsappAlertJob` (also `urgent`) only when `WhatsappAlerts.enabled?`
     and the musician's profile has a phone number and a recorded WhatsApp consent (`WhatsappAlerts.eligible?`). The job
     posts one template message to the Cloud API, retries network and HTTP errors five times
     with back-off, and logs a reason (never a number) when it skips.
   The matcher then increments `notified_count` and stamps `first_notified_at`.
6. **A musician responds.** `POST /api/urgent-requests/:id/respond` records the response, opens
   or reuses a conversation, writes the hirer a notification, sends the hirer an urgent push for
   the first response, and fires the first-response lifecycle email. The hirer picks someone or
   marks the request filled; `UrgentRequestsSweepJob` (every 30 minutes) warns the hirer 6 hours before
   a responded-to request expires, and expires open requests at 48 hours. Admins can see candidates and re-notify from the
   admin site (`/api/admin/urgent-requests/:id/candidates`, `/notify`), which reuses the same
   matcher and the same once-per-channel rows.

## Where things are logged

- Every API request writes one `http_request` line with method, path, status, duration and
  query count (JSON per-request logging with request ids is PR #183). Jobs log counts-only JSON
  lines (`push_delivery`, `notification_email_skipped`, `whatsapp_alert_skipped`).
- Errors go to Sentry when the DSNs are set; both sides scrub emails, tokens and codes first.
- Sensitive actions go to `audit_logs` (admin UI → Audit).
- Railway → service → Logs is where the lines above appear; Vercel → project → Logs shows edge
  and function logs for the frontend.

## Related documents

- [RULES.md](RULES.md): the engineering rules and the config-not-code list.
- [RUNBOOK.md](RUNBOOK.md): site down, payments, email, restore, security incident.
- [../ops/RUNBOOKS.md](../ops/RUNBOOKS.md): deploy skipped, Postgres exhaustion, Razorpay
  webhooks, Brevo outage, R2 misconfiguration.
- [../ops/](../ops/): one page per configurable area (edge caching, job queues, search, uploads,
  web push, web performance, billing invoices).
- [SAAS_BILLING.md](SAAS_BILLING.md), [SEARCH.md](SEARCH.md), [SESSIONS.md](SESSIONS.md).
